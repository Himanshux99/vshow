import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthConfigError,
  DevAuthError,
  PRODUCTION_ORIGIN,
  VAUTH,
  deriveNameFromEmail,
  evaluateClaims,
  isAllowedEmail,
  isValidSubject,
  normalizeName,
  resolveAuthConfig,
  resolveDevAuth,
} from "../app/auth/config.server.ts";
import { isAllowedAuthRequest } from "../app/auth/route-policy.server.ts";
import { assertLocalComposeTarget } from "../app/db/local-target.server.ts";
import { createContainer } from "../app/server/container.server.ts";

const SECRET = "a-very-secret-value-that-is-long-enough-0123456789";
const CLIENT_SECRET = "client-secret-value-0123456789";

const devEnv = {
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "http://localhost:5173",
  VOSS_DISCOVERY_URL: VAUTH.discoveryUrl,
  VOSS_CLIENT_ID: "vshow-dev-client",
  VOSS_CLIENT_SECRET: CLIENT_SECRET,
};
const prodEnv = {
  ...devEnv,
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  BETTER_AUTH_URL: PRODUCTION_ORIGIN,
};

const rejects = (env: Record<string, string | undefined>, pattern: RegExp) =>
  assert.throws(
    () => resolveAuthConfig(env),
    (e: unknown) => {
      assert.ok(e instanceof AuthConfigError, String(e));
      assert.match(e.message, pattern);
      for (const secret of [SECRET, CLIENT_SECRET]) assert.ok(!e.message.includes(secret), "message leaks a secret");
      return true;
    },
  );

describe("auth environment validation", () => {
  it("accepts a valid development configuration", () => {
    const c = resolveAuthConfig(devEnv);
    assert.equal(c.baseURL, "http://localhost:5173");
    assert.equal(c.issuer, VAUTH.issuer);
    assert.equal(c.secureCookies, false);
    assert.equal(c.production, false);
  });

  it("accepts the production configuration: https, exact origin, pinned discovery", () => {
    const c = resolveAuthConfig(prodEnv);
    assert.deepEqual(
      [c.baseURL, c.secureCookies, c.production, c.issuer],
      [PRODUCTION_ORIGIN, true, true, VAUTH.issuer],
    );
  });

  for (const name of [
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "VOSS_DISCOVERY_URL",
    "VOSS_CLIENT_ID",
    "VOSS_CLIENT_SECRET",
  ]) {
    it(`requires ${name}`, () => {
      rejects({ ...devEnv, [name]: undefined }, new RegExp(`${name} is not set`));
      rejects({ ...devEnv, [name]: "   " }, new RegExp(`${name} is not set`));
    });
  }

  it("rejects placeholder and weak secrets", () => {
    rejects({ ...devEnv, BETTER_AUTH_SECRET: "change-me" }, /placeholder/);
    rejects({ ...devEnv, BETTER_AUTH_SECRET: "short" }, /at least 32/);
    rejects({ ...devEnv, VOSS_CLIENT_SECRET: "change-me" }, /placeholder/);
    rejects({ ...devEnv, VOSS_CLIENT_SECRET: "tiny" }, /too short/);
    rejects({ ...devEnv, VOSS_CLIENT_ID: "has space" }, /malformed/);
  });

  it("BETTER_AUTH_URL must be a bare origin", () => {
    for (const bad of [
      "http://localhost:5173/",
      "http://localhost:5173/app",
      "http://localhost:5173?x=1",
      "http://localhost:5173#f",
      "http://user:pw@localhost:5173",
      "not a url",
      "ftp://localhost",
    ]) {
      if (bad === "http://localhost:5173/") {
        // a lone trailing slash normalises to the origin and is accepted
        assert.equal(resolveAuthConfig({ ...devEnv, BETTER_AUTH_URL: bad }).baseURL, "http://localhost:5173");
        continue;
      }
      rejects({ ...devEnv, BETTER_AUTH_URL: bad }, /BETTER_AUTH_URL/);
    }
  });

  it("outside production, http is allowed only for localhost", () => {
    rejects({ ...devEnv, BETTER_AUTH_URL: "http://vshow.example.test" }, /http only for localhost/);
    assert.equal(resolveAuthConfig({ ...devEnv, BETTER_AUTH_URL: "https://vshow.example.test" }).secureCookies, true);
  });

  it("production requires https, forbids localhost, and (for the real environment) the exact origin", () => {
    rejects({ ...prodEnv, BETTER_AUTH_URL: "http://vshow.vosslabs.org" }, /https in production/);
    rejects({ ...prodEnv, BETTER_AUTH_URL: "https://localhost" }, /not be localhost/);
    rejects({ ...prodEnv, BETTER_AUTH_URL: "https://other.vosslabs.org" }, /exactly https:\/\/vshow\.vosslabs\.org/);
    rejects(
      { ...prodEnv, VERCEL_ENV: undefined, APP_ENV: "production", BETTER_AUTH_URL: "https://x.example.test" },
      /exactly/,
    );
    // A preview deployment (production build, different origin, not the real production environment) is allowed.
    assert.equal(
      resolveAuthConfig({ ...prodEnv, VERCEL_ENV: "preview", BETTER_AUTH_URL: "https://preview.example.test" }).baseURL,
      "https://preview.example.test",
    );
  });

  it("production pins the vauth discovery URL; elsewhere only https or localhost is allowed", () => {
    rejects(
      { ...prodEnv, VOSS_DISCOVERY_URL: "https://evil.example/api/auth/.well-known/openid-configuration" },
      /pinned/,
    );
    rejects(
      { ...devEnv, VOSS_DISCOVERY_URL: "http://evil.example/api/auth/.well-known/openid-configuration" },
      /http only for localhost/,
    );
    rejects({ ...devEnv, VOSS_DISCOVERY_URL: "https://accounts.vosslabs.org/api/auth/jwks" }, /must end with/);
    rejects({ ...devEnv, VOSS_DISCOVERY_URL: `${VAUTH.discoveryUrl}?x=1` }, /query or fragment/);
    assert.equal(
      resolveAuthConfig({
        ...devEnv,
        VOSS_DISCOVERY_URL: "http://127.0.0.1:9999/api/auth/.well-known/openid-configuration",
      }).issuer,
      "http://127.0.0.1:9999/api/auth",
    );
  });
});

describe("vauth credentials are optional only for the dev switcher", () => {
  const noClient = { ...devEnv, VOSS_CLIENT_ID: undefined, VOSS_CLIENT_SECRET: undefined };

  it("are required by default, which is the production behaviour", () => {
    rejects(noClient, /VOSS_CLIENT_ID is not set/);
    assert.throws(() => resolveAuthConfig(noClient, { oauthOptional: false }), AuthConfigError);
  });

  it("may both be absent when explicitly allowed: the provider is then simply not configured", () => {
    assert.equal(resolveAuthConfig(noClient, { oauthOptional: true }).oauth, null);
    assert.equal(
      resolveAuthConfig({ ...noClient, VOSS_CLIENT_ID: "  ", VOSS_CLIENT_SECRET: "" }, { oauthOptional: true }).oauth,
      null,
    );
  });

  it("must still be supplied TOGETHER and valid when either is present", () => {
    assert.throws(
      () => resolveAuthConfig({ ...noClient, VOSS_CLIENT_ID: "id-only" }, { oauthOptional: true }),
      AuthConfigError,
    );
    assert.throws(
      () => resolveAuthConfig({ ...noClient, VOSS_CLIENT_SECRET: CLIENT_SECRET }, { oauthOptional: true }),
      AuthConfigError,
    );
    assert.throws(
      () => resolveAuthConfig({ ...devEnv, VOSS_CLIENT_SECRET: "tiny" }, { oauthOptional: true }),
      AuthConfigError,
    );
    assert.deepEqual(resolveAuthConfig(devEnv, { oauthOptional: true }).oauth, {
      clientId: "vshow-dev-client",
      clientSecret: CLIENT_SECRET,
    });
  });

  it("the composition root grants the exemption only when the switcher is enabled", () => {
    const local = {
      BETTER_AUTH_SECRET: SECRET,
      BETTER_AUTH_URL: "http://localhost:5173",
      VOSS_DISCOVERY_URL: VAUTH.discoveryUrl,
      LOG_LEVEL: "silent",
    };
    const withSwitcher = createContainer(
      {
        ...local,
        VSHOW_DEV_AUTH: "1",
        APP_ENV: "development",
        DB_TARGET: "local",
        DATABASE_URL: "postgresql://vshow:pw@127.0.0.1:5432/vshow",
      },
      false,
    );
    assert.equal(withSwitcher.auth.config().oauth, null);
    const without = createContainer({ ...local, APP_ENV: "development" }, false);
    assert.throws(() => without.auth.config(), AuthConfigError);
    const prod = createContainer(
      { ...local, NODE_ENV: "production", BETTER_AUTH_URL: "https://vshow.example.test" },
      false,
    );
    assert.throws(() => prod.auth.config(), AuthConfigError);
  });
});

describe("email allowlist (exact domain match)", () => {
  const ok = ["a@vit.edu.in", "First.Last@VIT.EDU.IN", "x+tag@vosslabs.org", "a_b-c@vit.edu.in"];
  const bad = [
    "a@gmail.com",
    "a@vit.edu.in.evil.com",
    "a@evilvit.edu.in",
    "a@mail.vit.edu.in",
    "a@evil.com@vit.edu.in",
    "@vit.edu.in",
    "a@",
    "a",
    "",
    "a b@vit.edu.in",
    "a@vit.edu.in ",
    "a@vit.edu.in,b@vit.edu.in",
    "a\n@vit.edu.in",
    "<a>@vit.edu.in",
    `${"a".repeat(320)}@vit.edu.in`,
  ];
  for (const e of ok) it(`accepts ${JSON.stringify(e)}`, () => assert.equal(isAllowedEmail(e), true));
  for (const e of bad) it(`rejects ${JSON.stringify(e)}`, () => assert.equal(isAllowedEmail(e), false));
  it("rejects non-strings", () => {
    for (const v of [undefined, null, 5, {}, ["a@vit.edu.in"]]) assert.equal(isAllowedEmail(v), false);
  });
});

describe("claim evaluation", () => {
  const good = { sub: "abc123", email: "A.B@vit.edu.in", email_verified: true, name: "Ab C" };

  it("accepts a verified allowed identity and normalises the email", () => {
    const r = evaluateClaims(good);
    assert.ok(r.ok);
    assert.deepEqual(r.identity, { sub: "abc123", email: "a.b@vit.edu.in", name: "Ab C", emailVerified: true });
  });

  it("reports the reason for each rejection, keeping the subject only when it is well formed", () => {
    const reason = (c: Record<string, unknown>) => {
      const r = evaluateClaims({ ...good, ...c });
      return r.ok ? "ok" : r.reason;
    };
    assert.equal(reason({ sub: undefined }), "sub_invalid");
    assert.equal(reason({ sub: "" }), "sub_invalid");
    assert.equal(reason({ sub: 7 }), "sub_invalid");
    assert.equal(reason({ email: undefined }), "email_missing");
    assert.equal(reason({ email_verified: "true" }), "email_not_verified");
    assert.equal(reason({ email_verified: 1 }), "email_not_verified");
    assert.equal(reason({ email: "a@gmail.com" }), "email_domain_not_allowed");
    const rejected = evaluateClaims({ ...good, email: "a@gmail.com" });
    assert.ok(!rejected.ok && rejected.sub === "abc123");
    const noSub = evaluateClaims({ ...good, sub: "" });
    assert.ok(!noSub.ok && noSub.sub === undefined);
  });

  it("validates subjects", () => {
    for (const s of ["a", "x".repeat(255), "uuid-1234-abcd"]) assert.equal(isValidSubject(s), true, s);
    for (const s of ["", " ", " a", "a ", "a b", "a\tb", "x".repeat(256), 1, null, undefined, {}]) {
      assert.equal(isValidSubject(s), false, String(s));
    }
  });

  it("always yields a usable name", () => {
    assert.equal(normalizeName("  Jane   Doe ", "x@vit.edu.in"), "Jane Doe");
    assert.equal(normalizeName(undefined, "jane.doe@vit.edu.in"), "Jane Doe");
    assert.equal(normalizeName("   ", "jane_doe@vit.edu.in"), "Jane Doe");
    assert.equal(normalizeName(42, "solo@vit.edu.in"), "Solo");
    assert.equal(normalizeName("N".repeat(500), "x@vit.edu.in").length, 200);
    assert.equal(normalizeName("a\u0000b\nc", "x@vit.edu.in"), "a b c");
    assert.equal(deriveNameFromEmail("...@vit.edu.in"), "...@vit.edu.in");
  });
});

describe("development identity switcher guard (fails closed)", () => {
  const okDb = () => {};
  const failDb = () => {
    throw new Error("not the local database");
  };
  const good = { VSHOW_DEV_AUTH: "1", APP_ENV: "development", BETTER_AUTH_URL: "http://localhost:5173" };

  it("is off unless the flag is set; empty means off", () => {
    assert.deepEqual(resolveDevAuth({}, failDb), { enabled: false });
    assert.deepEqual(resolveDevAuth({ VSHOW_DEV_AUTH: "" }, failDb), { enabled: false });
    assert.deepEqual(resolveDevAuth({ VSHOW_DEV_AUTH: "  " }, failDb), { enabled: false });
  });

  it("is enabled only when every condition holds", () => {
    assert.deepEqual(resolveDevAuth(good, okDb), { enabled: true });
    assert.deepEqual(resolveDevAuth({ ...good, BETTER_AUTH_URL: "http://127.0.0.1:5173" }, okDb), { enabled: true });
  });

  const refused: Array<[string, Record<string, string | undefined>, () => void]> = [
    ["flag is not exactly 1 (true)", { VSHOW_DEV_AUTH: "true" }, okDb],
    ["flag is not exactly 1 (0)", { VSHOW_DEV_AUTH: "0" }, okDb],
    ["APP_ENV is production", { APP_ENV: "production" }, okDb],
    ["APP_ENV is test", { APP_ENV: "test" }, okDb],
    ["APP_ENV is preview", { APP_ENV: "preview" }, okDb],
    ["APP_ENV is unset", { APP_ENV: undefined }, okDb],
    ["NODE_ENV is production", { NODE_ENV: "production" }, okDb],
    ["VERCEL is set", { VERCEL: "1" }, okDb],
    ["VERCEL_ENV is preview", { VERCEL_ENV: "preview" }, okDb],
    ["VERCEL_ENV is production", { VERCEL_ENV: "production" }, okDb],
    ["BETTER_AUTH_URL is the production origin", { BETTER_AUTH_URL: PRODUCTION_ORIGIN }, okDb],
    ["BETTER_AUTH_URL is a lookalike host", { BETTER_AUTH_URL: "http://localhost.evil.example" }, okDb],
    ["BETTER_AUTH_URL is missing", { BETTER_AUTH_URL: undefined }, okDb],
    ["the database guard fails", {}, failDb],
  ];
  for (const [name, change, db] of refused) {
    it(`THROWS (refuses to start) when ${name}`, () => {
      assert.throws(() => resolveDevAuth({ ...good, ...change }, db), DevAuthError);
    });
  }

  it("the error never contains the database URL", () => {
    assert.throws(
      () =>
        resolveDevAuth(good, () =>
          assertLocalComposeTarget({ DB_TARGET: "neon", DATABASE_URL: "postgresql://u:topsecretpw@ep-x.neon.tech/db" }),
        ),
      (e: unknown) => e instanceof DevAuthError && !e.message.includes("topsecretpw"),
    );
  });

  it("the composition root refuses to build with an unsafe flag, using the real shared database guard", () => {
    const local = {
      ...good,
      DB_TARGET: "local",
      DATABASE_URL: "postgresql://vshow:pw@127.0.0.1:5432/vshow",
      LOG_LEVEL: "silent",
    };
    assert.equal(createContainer(local, false).auth.devAuth.enabled, true);
    for (const change of [
      { NODE_ENV: "production" },
      { VERCEL: "1" },
      { APP_ENV: "production" },
      { DB_TARGET: "neon", DATABASE_URL: "postgresql://u:pw@ep-x.neon.tech/db?sslmode=require" },
      { DATABASE_URL: "postgresql://vshow:pw@127.0.0.1:6543/vshow" },
      { DATABASE_URL: "postgresql://vshow:pw@127.0.0.1:5432/campus_live" },
    ]) {
      assert.throws(
        () => createContainer({ ...local, ...change }, false),
        DevAuthError,
        JSON.stringify(Object.keys(change)),
      );
    }
    assert.equal(createContainer({ ...local, VSHOW_DEV_AUTH: "" }, false).auth.devAuth.enabled, false);
  });
});

describe("/api/auth/* request policy (default deny)", () => {
  const off = { devAuth: { enabled: false } };
  const on = { devAuth: { enabled: true } };

  it("allows exactly the OAuth callback for the voss provider and the health check", () => {
    assert.equal(isAllowedAuthRequest("GET", "/api/auth/oauth2/callback/voss", off), true);
    assert.equal(isAllowedAuthRequest("get", "/api/auth/oauth2/callback/voss", off), true);
    assert.equal(isAllowedAuthRequest("GET", "/api/auth/ok", off), true);
  });

  it("denies everything else, including methods, other providers and lookalike paths", () => {
    const denied: Array<[string, string]> = [
      ["POST", "/api/auth/oauth2/callback/voss"],
      ["GET", "/api/auth/oauth2/callback/github"],
      ["GET", "/api/auth/oauth2/callback/voss/extra"],
      ["GET", "/api/auth/oauth2/callback/VOSS"],
      ["GET", "/api/auth/callback/voss"],
      ["POST", "/api/auth/callback/voss"],
      ["GET", "/api/auth/get-session"],
      ["POST", "/api/auth/sign-out"],
      ["POST", "/api/auth/sign-in/oauth2"],
      ["POST", "/api/auth/sign-in/email"],
      ["POST", "/api/auth/sign-up/email"],
      ["POST", "/api/auth/update-user"],
      ["POST", "/api/auth/oauth2/link"],
      ["GET", "/api/auth/list-sessions"],
      ["GET", "/api/auth"],
      ["GET", "/api/auth/"],
      ["GET", "/api/authx/ok"],
      ["GET", "/api/auth/../me"],
      ["GET", "/other"],
    ];
    for (const [m, p] of denied) assert.equal(isAllowedAuthRequest(m, p, off), false, `${m} ${p}`);
  });

  it("allows the dev sign-in endpoint only when the switcher is enabled, and only as POST", () => {
    assert.equal(isAllowedAuthRequest("POST", "/api/auth/dev/sign-in", off), false);
    assert.equal(isAllowedAuthRequest("POST", "/api/auth/dev/sign-in", on), true);
    assert.equal(isAllowedAuthRequest("GET", "/api/auth/dev/sign-in", on), false);
  });
});
