// End-to-end authentication tests: the real Better Auth instance Vshow ships, a mock OIDC provider with
// generated EdDSA keys, and a disposable local database. No real credentials and no external network.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { DISABLED_PATHS, createAuthLogBridge } from "../app/auth/auth.server.ts";
import { expiredAuthCookies } from "../app/auth/session-cookies.server.ts";
import { captureLogs } from "./helpers.ts";
import {
  CookieJar,
  TEST_SECRET,
  createAuthHarness,
  type AuthHarness,
  type SignInResult,
} from "./support/auth-harness.ts";

const h: AuthHarness = await createAuthHarness();
const opts = { skip: h.skipReason || false };
const SUB = "vauth-user-0001";
const EMAIL = "student.one@vit.edu.in";

const count = async (table: string) => Number((await h.q(`select count(*)::int n from ${table}`))[0].n);
async function assertNothingCreated(r: SignInResult) {
  assert.ok(r.errorCode, `expected the sign-in to be denied but it was not (location ${r.location})`);
  assert.deepEqual(
    [await count("app_user"), await count("auth_account"), await count("auth_session")],
    [0, 0, 0],
    "a denied sign-in must create no user, account or session",
  );
  assert.equal(r.jar.names().filter((n) => n.includes("session_token")).length, 0, "no session cookie may be issued");
}

before(async () => {
  if (!h.skipReason) await h.q("select 1");
});
after(async () => {
  if (!h.skipReason) await h.close();
});
beforeEach(async () => {
  if (h.skipReason) return;
  h.idp.reset();
  for (const t of ["auth_session", "auth_account", "auth_verification", "user_role"]) await h.q(`delete from ${t}`);
  await h.q("delete from app_user");
});

describe("successful sign-in and sign-out", () => {
  it("signs in through the full PKCE flow, creating a role-less user, with a secure session cookie", opts, async () => {
    const r = await h.signIn();
    assert.equal(r.status, 302);
    assert.equal(r.location, "/me");
    assert.equal(r.errorCode, null);

    const cookie = r.setCookies.find((c) => c.startsWith("vshow.session_token="));
    assert.ok(cookie, "session cookie with the vshow prefix");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.doesNotMatch(cookie, /;\s*Secure/i, "http localhost origin: no Secure flag");

    const [user] = await h.q(
      "select email, email_verified, display_name, vauth_subject, is_active, image from app_user",
    );
    assert.deepEqual(user, {
      email: EMAIL,
      email_verified: true,
      display_name: "Student One",
      vauth_subject: SUB,
      is_active: true,
      image: null,
    });
    assert.equal(await count("user_role"), 0, "first login must NOT assign any role");
    assert.equal(await count("committee_membership"), 0);

    const session = await h.getSession(r.jar);
    assert.equal(session?.user.email, EMAIL);
  });

  it("every cookie a real sign-in sets is covered by the local sign-out cookie list (no drift)", opts, async () => {
    const names = (setCookies: string[]) => setCookies.map((c) => c.split("=")[0]);
    const begun = await h.auth.api.signInWithOAuth2({
      body: { providerId: "voss", callbackURL: "/me" },
      headers: new Headers({ origin: h.baseURL }),
      asResponse: true,
    });
    const r = await h.signIn();
    const setByBetterAuth = new Set([...names(begun.headers.getSetCookie()), ...names(r.setCookies)]);
    assert.ok(setByBetterAuth.has("vshow.state") && setByBetterAuth.has("vshow.session_token"));
    const covered = new Set(expiredAuthCookies().map((c) => c.split("=")[0]));
    for (const name of setByBetterAuth) assert.ok(covered.has(name), `${name} is not cleared by the local sign-out`);
  });

  it("sends the right authorization request: PKCE S256, scopes, exact redirect URI, state", opts, async () => {
    const { authorizeUrl } = await h.begin();
    const q = new URL(authorizeUrl).searchParams;
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.ok(q.get("code_challenge"));
    assert.equal(q.get("scope"), "openid profile email");
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("client_id"), h.idp.clientId);
    assert.equal(q.get("redirect_uri"), `${h.baseURL}/api/auth/oauth2/callback/voss`);
    assert.ok((q.get("state") ?? "").length >= 16);
    assert.equal(q.get("response_mode"), null, "form_post is not used: vauth supports the query response mode only");
  });

  it("a second sign-in with the same subject reuses the same user and stores nothing new", opts, async () => {
    await h.signIn();
    const second = await h.signIn();
    assert.equal(second.errorCode, null);
    assert.equal(await count("app_user"), 1);
    assert.equal(await count("auth_account"), 1);
    assert.equal(await count("auth_session"), 2);
  });

  it("sign-out ends the Vshow session only and never calls the identity provider", opts, async () => {
    const r = await h.signIn();
    const callsBefore = h.idp.requests.length;
    const res = await h.auth.api.signOut({
      headers: new Headers({ cookie: r.jar.header(), origin: h.baseURL }),
      asResponse: true,
    });
    assert.equal(res.status, 200);
    r.jar.add(res.headers.getSetCookie());
    assert.equal(await count("auth_session"), 0);
    assert.equal(await h.getSession(r.jar), null);
    assert.equal(await count("app_user"), 1, "the user remains; only the session ends");
    assert.equal(h.idp.requests.length, callsBefore, "logout must not contact vauth (no SSO logout)");
    assert.ok(!h.idp.requests.some((x) => /end_session|logout|sign-out/i.test(x.path)));
  });
});

describe("ID token verification (signature, issuer, audience, algorithm, expiry)", () => {
  const bad: Array<[string, () => void]> = [
    ["wrong issuer", () => (h.idp.tweaks.token.iss = "https://evil.example/api/auth")],
    ["wrong audience", () => (h.idp.tweaks.token.aud = "some-other-client")],
    ["audience list without our client", () => (h.idp.tweaks.token.aud = ["a", "b"])],
    ["HS256 instead of EdDSA", () => (h.idp.tweaks.token.alg = "HS256")],
    ["ES256 instead of EdDSA", () => (h.idp.tweaks.token.alg = "ES256")],
    ["unsigned (alg none)", () => (h.idp.tweaks.token.alg = "none")],
    ["signed by a key that is not in the JWKS", () => (h.idp.tweaks.token.unknownKey = true)],
    ["expired token", () => (h.idp.tweaks.token.expiresInSeconds = -3600)],
    ["token issued long ago", () => (h.idp.tweaks.token.issuedAtOffsetSeconds = -3 * 3600)],
    ["no ID token at all", () => (h.idp.tweaks.token.omitIdToken = true)],
  ];
  for (const [name, tweak] of bad) {
    it(`denies sign-in: ${name}`, opts, async () => {
      tweak();
      await assertNothingCreated(await h.signIn());
    });
  }
});

describe("authorization-response protocol checks", () => {
  it("denies a callback with no `iss` parameter (issuer validation is required)", opts, async () => {
    h.idp.tweaks.authorize.omitIss = true;
    const r = await h.signIn();
    assert.equal(r.errorCode, "issuer_missing");
    await assertNothingCreated(r);
  });

  it("denies a callback with the wrong `iss`", opts, async () => {
    h.idp.tweaks.authorize.iss = "https://evil.example/api/auth";
    const r = await h.signIn();
    assert.equal(r.errorCode, "issuer_mismatch");
    await assertNothingCreated(r);
  });

  it("denies a tampered `state`", opts, async () => {
    h.idp.tweaks.authorize.state = "tampered-state-value-0123456789abcdef";
    await assertNothingCreated(await h.signIn());
  });

  it(
    "denies a callback that arrives without the browser's state cookie (leaked code + state are useless)",
    opts,
    async () => {
      const { authorizeUrl } = await h.begin(new CookieJar());
      const authz = await fetch(authorizeUrl, { redirect: "manual" });
      const res = await h.auth.handler(new Request(authz.headers.get("location") as string)); // no cookie
      assert.equal(res.status, 302);
      assert.ok(new URL(res.headers.get("location") as string, h.baseURL).searchParams.get("error"));
      assert.equal(await count("app_user"), 0);
      assert.equal(await count("auth_session"), 0);
    },
  );

  it("denies a wrong PKCE verifier at the token endpoint", opts, async () => {
    h.idp.tweaks.breakPkce = true;
    const r = await h.signIn();
    assert.equal(r.errorCode, "oauth_code_verification_failed");
    await assertNothingCreated(r);
  });

  it("denies when the token endpoint fails", opts, async () => {
    h.idp.tweaks.tokenError = true;
    await assertNothingCreated(await h.signIn());
  });

  it("denies a replayed callback (the state and the code are single-use)", opts, async () => {
    const first = await h.signIn();
    assert.equal(first.errorCode, null);
    await h.q("delete from auth_session");
    const replay = await h.auth.handler(new Request(first.callbackUrl, { headers: { cookie: first.jar.header() } }));
    assert.ok(new URL(replay.headers.get("location") as string, h.baseURL).searchParams.get("error"));
    assert.equal(await count("auth_session"), 0);
  });
});

describe("claim validation", () => {
  const rejected: Array<[string, Record<string, unknown>]> = [
    ["missing sub", { sub: undefined }],
    ["empty sub", { sub: "" }],
    ["whitespace sub", { sub: "   " }],
    ["sub with surrounding space", { sub: " abc " }],
    ["sub containing control characters", { sub: "ab\u0000c" }],
    ["sub too long for the database column", { sub: "x".repeat(256) }],
    ["non-string sub", { sub: 12345 }],
    ["email_verified false", { email_verified: false }],
    ["email_verified the string 'true'", { email_verified: "true" }],
    ["email_verified missing", { email_verified: undefined }],
    ["email missing", { email: undefined }],
    ["domain not allowed (gmail)", { email: "someone@gmail.com" }],
    ["lookalike suffix domain", { email: "someone@vit.edu.in.evil.com" }],
    ["subdomain of an allowed domain", { email: "someone@mail.vit.edu.in" }],
    ["two @ signs ending in an allowed domain", { email: "a@evil.com@vit.edu.in" }],
    ["empty local part", { email: "@vit.edu.in" }],
    ["whitespace in the address", { email: "some one@vit.edu.in" }],
    ["list of addresses", { email: "a@vit.edu.in,b@vit.edu.in" }],
    ["non-string email", { email: ["a@vit.edu.in"] }],
  ];
  for (const [name, change] of rejected) {
    it(`denies sign-in: ${name}`, opts, async () => {
      Object.assign(h.idp.tweaks.profile, change);
      await assertNothingCreated(await h.signIn());
    });
  }

  it("accepts both allowed domains and stores the email lower-cased", opts, async () => {
    Object.assign(h.idp.tweaks.profile, { email: "Staff.Member@VosSLabs.org" });
    const r = await h.signIn();
    assert.equal(r.errorCode, null);
    assert.equal((await h.q("select email from app_user"))[0].email, "staff.member@vosslabs.org");
  });

  it("handles a missing optional name by deriving a non-empty one", opts, async () => {
    Object.assign(h.idp.tweaks.profile, { name: undefined, email: "jane_q.doe@vit.edu.in" });
    const r = await h.signIn();
    assert.equal(r.errorCode, null);
    assert.equal((await h.q("select display_name from app_user"))[0].display_name, "Jane Q Doe");
  });

  it("treats a blank or non-string name as missing, and caps an overlong name", opts, async () => {
    Object.assign(h.idp.tweaks.profile, { name: "   ", email: "blank@vit.edu.in" });
    assert.equal((await h.signIn()).errorCode, null);
    assert.equal((await h.q("select display_name from app_user"))[0].display_name, "Blank");

    await h.q("delete from auth_session");
    await h.q("delete from auth_account");
    await h.q("delete from app_user");
    Object.assign(h.idp.tweaks.profile, { name: "N".repeat(500), email: "long@vit.edu.in", sub: "vauth-long" });
    assert.equal((await h.signIn()).errorCode, null);
    assert.equal((await h.q("select length(display_name)::int l from app_user"))[0].l, 200);
  });
});

describe("account linking and identity changes", () => {
  it("never links an OAuth identity to an existing user just because the email matches", opts, async () => {
    for (const verified of [true, false]) {
      await h.q("delete from app_user");
      await h.q("insert into app_user(email, display_name, email_verified) values ($1, 'Existing', $2)", [
        EMAIL,
        verified,
      ]);
      const r = await h.signIn();
      assert.ok(r.errorCode, `existing user (email_verified=${verified}) must not be linked`);
      assert.equal(await count("auth_account"), 0);
      assert.equal(await count("auth_session"), 0);
      assert.equal((await h.q("select vauth_subject s from app_user"))[0].s, null);
    }
  });

  it("a known subject returning with a changed, valid email updates the SAME user", opts, async () => {
    const first = await h.signIn();
    const idBefore = (await h.q("select id from app_user"))[0].id;
    h.idp.tweaks.profile.email = "student.renamed@vit.edu.in";
    const second = await h.signIn(first.jar);
    assert.equal(second.errorCode, null);
    const users = await h.q("select id, email, vauth_subject from app_user");
    assert.deepEqual(users, [{ id: idBefore, email: "student.renamed@vit.edu.in", vauth_subject: SUB }]);
  });

  it("denies a changed email that already belongs to another user, and merges nothing", opts, async () => {
    await h.signIn();
    await h.q("insert into app_user(email, display_name) values ('taken@vit.edu.in', 'Someone Else')");
    h.idp.tweaks.profile.email = "taken@vit.edu.in";
    const r = await h.signIn();
    assert.ok(r.errorCode);
    const emails = (await h.q("select email from app_user order by email")).map((x) => x.email);
    assert.deepEqual(emails, [EMAIL, "taken@vit.edu.in"]);
    assert.equal((await h.q("select vauth_subject s from app_user where email='taken@vit.edu.in'"))[0].s, null);
  });

  it("denies a known subject whose email is no longer allowed AND revokes its existing sessions", opts, async () => {
    const first = await h.signIn();
    assert.ok(await h.getSession(first.jar));
    h.idp.tweaks.profile.email = "now.personal@gmail.com";
    const r = await h.signIn();
    assert.ok(r.errorCode);
    assert.equal(await h.getSession(first.jar), null, "the earlier session must be revoked");
    assert.equal(await count("auth_session"), 0);
    assert.equal((await h.q("select email from app_user"))[0].email, EMAIL, "the stored email is left untouched");
  });

  it("a different subject with a free email is a new, separate user", opts, async () => {
    await h.signIn();
    Object.assign(h.idp.tweaks.profile, { sub: "vauth-user-0002", email: "second.person@vit.edu.in" });
    assert.equal((await h.signIn()).errorCode, null);
    assert.equal(await count("app_user"), 2);
  });
});

describe("transactional consistency", () => {
  it("rolls back the new user when the account insert fails (transaction: true is effective)", opts, async () => {
    await h.q(
      `create function vshow_test_fail_account() returns trigger language plpgsql as $$ begin raise exception 'forced account failure'; end $$`,
    );
    await h.q(
      "create trigger vshow_test_fail_account before insert on auth_account for each row execute function vshow_test_fail_account()",
    );
    try {
      const r = await h.signIn();
      assert.ok(r.errorCode);
      assert.equal(await count("app_user"), 0, "no orphan user may remain when linking fails");
      assert.equal(await count("auth_account"), 0);
    } finally {
      await h.q("drop trigger vshow_test_fail_account on auth_account");
      await h.q("drop function vshow_test_fail_account()");
    }
  });
});

describe("no OAuth tokens are ever persisted", () => {
  it("none of the tokens or codes the provider issued appear anywhere in the database", opts, async () => {
    const first = await h.signIn();
    await h.signIn(first.jar); // exercises the existing-account (update) path too
    const issued = [
      ...h.idp.issued.accessTokens,
      ...h.idp.issued.refreshTokens,
      ...h.idp.issued.idTokens,
      ...h.idp.issued.codes,
    ];
    assert.ok(issued.length >= 8);
    for (const table of ["app_user", "auth_account", "auth_session", "auth_verification"]) {
      const dump = (await h.q(`select coalesce(string_agg(to_jsonb(t)::text, ' '), '') d from ${table} t`))[0]
        .d as string;
      for (const token of issued) assert.ok(!dump.includes(token), `a provider token was stored in ${table}`);
    }
    const [acct] = await h.q(
      "select access_token, refresh_token, id_token, password, access_token_expires_at, refresh_token_expires_at, scope from auth_account",
    );
    assert.deepEqual(acct, {
      access_token: null,
      refresh_token: null,
      id_token: null,
      password: null,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
      scope: acct.scope, // the granted scope string is not a secret
    });
  });

  it("session rows carry no IP address or user agent", opts, async () => {
    await h.signIn();
    const [s] = await h.q("select ip_address, user_agent from auth_session");
    assert.deepEqual(s, { ip_address: null, user_agent: null });
  });
});

describe("session lifetime: sliding window, absolute cap, expiry, invalidation", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const setSession = (sql: string) =>
    h.q(`alter table auth_session disable trigger auth_session_cap_lifetime`).then(() => h.q(sql));
  const enableCap = () => h.q("alter table auth_session enable trigger auth_session_cap_lifetime");

  it("a new session lasts 7 days", opts, async () => {
    await h.signIn();
    const [s] = await h.q("select extract(epoch from expires_at - created_at)::int secs from auth_session");
    assert.equal(s.secs, 7 * 24 * 3600);
  });

  it("is refreshed (slides) only when more than a day old, extending to 7 days from now", opts, async () => {
    const r = await h.signIn();
    // Refreshed less than a day ago: unchanged.
    await h.q("update auth_session set expires_at = now() + interval '6 days 23 hours'");
    const fresh = (await h.q("select expires_at from auth_session"))[0].expires_at as Date;
    await h.getSession(r.jar);
    assert.equal(
      +(await h.q("select expires_at from auth_session"))[0].expires_at,
      +fresh,
      "no refresh within the update interval",
    );
    // Last refreshed 2 days ago: slides forward.
    await h.q("update auth_session set expires_at = now() + interval '5 days'");
    await h.getSession(r.jar);
    const slid = +(await h.q("select expires_at from auth_session"))[0].expires_at;
    assert.ok(Math.abs(slid - (Date.now() + 7 * DAY)) < 60_000, "expiry slid to about now + 7 days");
  });

  it("never slides beyond 30 days from creation (database-enforced), then expires", opts, async () => {
    const r = await h.signIn();
    await setSession(
      "update auth_session set created_at = now() - interval '29 days 12 hours', expires_at = now() + interval '5 days'",
    );
    await enableCap();
    await h.getSession(r.jar); // would slide to now + 7 days; the cap allows only ~12 more hours
    const [row] = await h.q(
      "select extract(epoch from (expires_at - (created_at + interval '30 days')))::int secs from auth_session",
    );
    assert.ok(row.secs <= 0, "expires_at must not exceed created_at + 30 days");
    const [left] = await h.q("select extract(epoch from (expires_at - now()))::int secs from auth_session");
    assert.ok(left.secs > 11 * 3600 && left.secs < 13 * 3600, `about 12 hours remain, got ${left.secs}s`);

    await setSession(
      "update auth_session set created_at = now() - interval '31 days', expires_at = now() - interval '1 day'",
    );
    await enableCap();
    assert.equal(await h.getSession(r.jar), null, "beyond 30 days the session is gone");
  });

  it("created_at cannot be moved forward to dodge the cap", opts, async () => {
    await h.signIn();
    await assert.rejects(h.q("update auth_session set created_at = now() + interval '1 day'"), /immutable/);
  });

  it("an expired session is rejected", opts, async () => {
    const r = await h.signIn();
    await h.q("update auth_session set expires_at = now() - interval '1 minute'");
    assert.equal(await h.getSession(r.jar), null);
  });

  it("a deleted session is rejected", opts, async () => {
    const r = await h.signIn();
    await h.q("delete from auth_session");
    assert.equal(await h.getSession(r.jar), null);
  });

  it("deactivating a user ends their sessions at once, and they cannot sign in again", opts, async () => {
    const r = await h.signIn();
    assert.ok(await h.getSession(r.jar));
    await h.q("update app_user set is_active = false");
    assert.equal(await h.getSession(r.jar), null, "existing sessions die immediately");
    const again = await h.signIn();
    assert.ok(again.errorCode, "a deactivated user is refused a new session");
    assert.equal((await h.q("select count(*)::int n from auth_session where expires_at > now()"))[0].n, 0);
  });
});

describe("hardening: endpoints, logging", () => {
  it("every path in DISABLED_PATHS exists in this Better Auth version and answers 404 over HTTP", opts, async () => {
    const real = new Set(Object.values(h.auth.api).map((e) => (e as { path?: string }).path));
    for (const p of DISABLED_PATHS) {
      assert.ok(real.has(p), `${p} is not a Better Auth endpoint any more (typo or version drift)`);
      const res = await h.auth.handler(
        new Request(`${h.baseURL}/api/auth${p}`, {
          method: "POST",
          headers: { origin: h.baseURL, "content-type": "application/json" },
          body: "{}",
        }),
      );
      assert.equal(res.status, 404, p);
    }
  });

  it("emails/passwords cannot be used to sign in or sign up", opts, async () => {
    const res = await h.auth.handler(
      new Request(`${h.baseURL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: h.baseURL, "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: "hunter22hunter22" }),
      }),
    );
    assert.equal(res.status, 404);
    assert.equal(await count("app_user"), 0);
  });

  it("the Better Auth log bridge forwards only errors, never raw profiles or request data", () => {
    const log = captureLogs();
    const bridge = createAuthLogBridge(log.logger);
    bridge(
      "error",
      "user info problem",
      { sub: "vauth-secret-sub", email: "x@vit.edu.in", access_token: "tok-123" },
      new Error("boom postgresql://u:pw@h/db"),
    );
    bridge("warn", "plain", "a string argument that must not be forwarded: tok-456");
    const text = log.text();
    assert.ok(!/vauth-secret-sub|x@vit\.edu\.in|tok-123|tok-456|u:pw/.test(text), text);
    assert.equal(log.records()[0].err?.type, "Error");
  });

  it(
    "across success and failure flows, no code, state, token, secret or cookie value reaches the logs",
    opts,
    async () => {
      const callbackUrls: string[] = [];
      const cookies: string[] = [];
      const run = async () => {
        const r = await h.signIn();
        callbackUrls.push(r.callbackUrl);
        cookies.push(...r.setCookies);
        return r;
      };
      await run();
      h.idp.tweaks.token.alg = "HS256";
      await run();
      h.idp.reset();
      h.idp.tweaks.authorize.omitIss = true;
      await run();
      h.idp.reset();
      h.idp.tweaks.profile.email = "x@gmail.com";
      await run();
      h.idp.reset();
      h.idp.tweaks.breakPkce = true;
      await run();

      const text = h.log.text();
      const secrets = [
        h.idp.clientSecret,
        TEST_SECRET,
        ...h.idp.issued.codes,
        ...h.idp.issued.accessTokens,
        ...h.idp.issued.refreshTokens,
        ...h.idp.issued.idTokens,
        ...callbackUrls.map((u) => new URL(u).searchParams.get("state") as string),
        ...cookies.map((c) => c.split(";")[0].split("=")[1]).filter((v) => v && v.length > 10),
        "student.one@vit.edu.in",
      ];
      assert.ok(secrets.length > 10);
      for (const s of secrets)
        assert.ok(!text.includes(s), `a sensitive value appeared in the logs: ${s.slice(0, 8)}…`);
    },
  );
});
