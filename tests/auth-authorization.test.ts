// Authorization (Stage C): who may do what is decided from the database on every request. These tests use
// REAL sessions (created by a real sign-in through the mock identity provider) and real role/membership rows.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { isRedirectResponse } from "./support/react-router-helpers.ts";
import {
  assertSameOrigin,
  canActForCommittee,
  hasAnyRole,
  requireApiRole,
  requireAssignedUser,
  requireRole,
  requireUnassigned,
  resolveAccess,
} from "../app/auth/authorize.server.ts";
import { ApiError } from "../app/server/api-response.server.ts";
import { createAuthHarness, type AuthHarness, type CookieJar } from "./support/auth-harness.ts";

const h: AuthHarness = await createAuthHarness();
const opts = { skip: h.skipReason || false };

after(async () => {
  if (!h.skipReason) await h.close();
});
beforeEach(async () => {
  if (h.skipReason) return;
  h.idp.reset();
  for (const t of ["auth_session", "auth_account", "auth_verification", "user_role", "committee_membership"]) {
    await h.q(`delete from ${t}`);
  }
  await h.q("delete from app_user");
  await h.q("delete from committee");
  await h.q("delete from app_role");
});

const scope = () => ({
  auth: { devAuth: { enabled: false }, config: () => h.config, get: () => h.auth },
  database: h.database,
  logger: h.log.logger,
});
const req = (jar?: CookieJar, path = "/me") =>
  new Request(`${h.baseURL}${path}`, { headers: jar ? { cookie: jar.header() } : {} });

async function signedInUser() {
  const r = await h.signIn();
  assert.equal(r.errorCode, null);
  const [user] = await h.q<{ id: string }>("select id from app_user");
  return { jar: r.jar, userId: user.id };
}
async function grantRole(userId: string, code: string) {
  const [role] = await h.q<{ id: string }>(
    "insert into app_role(code, name) values ($1::text, $1::text) on conflict (code) do update set name = excluded.name returning id",
    [code],
  );
  await h.q("insert into user_role(user_id, role_id) values ($1, $2)", [userId, role.id]);
}
async function committee(code: string, active = true) {
  const [c] = await h.q<{ id: string }>(
    "insert into committee(name, code, is_active) values ($1::text, $1::text, $2) returning id",
    [code, active],
  );
  return c.id;
}
async function member(userId: string, committeeId: string, active = true, type = "CONVENER") {
  await h.q(
    "insert into committee_membership(committee_id, user_id, membership_type, is_active) values ($1,$2,$3,$4)",
    [committeeId, userId, type, active],
  );
}
const thrown = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

describe("who is asking", () => {
  it("no session cookie: anonymous, and page guards redirect to /login", opts, async () => {
    assert.deepEqual(await resolveAccess(scope(), new Headers()), { status: "anonymous" });
    const err = await thrown(requireRole(scope(), req(), ["ADMIN"]));
    assert.ok(isRedirectResponse(err, "/login"));
  });

  it("a garbage or forged session cookie is anonymous", opts, async () => {
    const headers = new Headers({ cookie: "vshow.session_token=not-a-real-token.deadbeef" });
    assert.deepEqual(await resolveAccess(scope(), headers), { status: "anonymous" });
  });

  it("a freshly signed-in user with no role is UNASSIGNED: never given a default role", opts, async () => {
    const { jar } = await signedInUser();
    const access = await resolveAccess(scope(), req(jar).headers);
    assert.equal(access.status, "unassigned");
    assert.ok(access.status === "unassigned" && access.user.roles.length === 0);
    assert.ok(isRedirectResponse(await thrown(requireAssignedUser(scope(), req(jar))), "/unclaimed"));
    assert.ok(isRedirectResponse(await thrown(requireRole(scope(), req(jar), ["ADMIN", "REVIEWER"])), "/unclaimed"));
    assert.equal((await requireUnassigned(scope(), req(jar))).email, "student.one@vit.edu.in");
    assert.equal(
      await h.q("select 1 from user_role").then((r) => r.length),
      0,
      "authorization code never writes roles",
    );
  });
});

describe("role checks are allowlists, read from the database every request", () => {
  it("grants access only to the listed roles; other roles get 403", opts, async () => {
    const { jar, userId } = await signedInUser();
    await grantRole(userId, "REVIEWER");
    assert.equal((await requireRole(scope(), req(jar), ["REVIEWER"])).roles[0], "REVIEWER");
    const err = await thrown(requireRole(scope(), req(jar), ["SERVER_ROOM_MANAGER", "ADMIN"]));
    assert.equal((err as { init?: { status?: number } }).init?.status, 403);
    assert.ok(!isRedirectResponse(err, "/login"));
  });

  it("an empty allowlist is a programming error and denies everyone", opts, async () => {
    const { jar, userId } = await signedInUser();
    await grantRole(userId, "ADMIN");
    await assert.rejects(requireRole(scope(), req(jar), []), /at least one allowed role/);
    await assert.rejects(requireApiRole(scope(), req(jar), []), /at least one allowed role/);
    assert.equal(hasAnyRole({ roles: ["ADMIN"] } as never, []), false);
  });

  it("role assignment takes effect immediately, and revocation too (no stale session authority)", opts, async () => {
    const { jar, userId } = await signedInUser();
    assert.equal((await resolveAccess(scope(), req(jar).headers)).status, "unassigned");
    await grantRole(userId, "REVIEWER");
    assert.equal((await resolveAccess(scope(), req(jar).headers)).status, "ok");
    await h.q("delete from user_role where user_id = $1", [userId]);
    assert.equal(
      (await resolveAccess(scope(), req(jar).headers)).status,
      "unassigned",
      "revocation applies to the SAME session",
    );
    assert.ok(isRedirectResponse(await thrown(requireRole(scope(), req(jar), ["REVIEWER"])), "/unclaimed"));
  });

  it("roles come only from Vshow's tables, never from identity-provider claims", opts, async () => {
    Object.assign(h.idp.tweaks.profile, {
      role: "ADMIN",
      roles: ["ADMIN", "REVIEWER"],
      groups: ["admins"],
      is_admin: true,
    });
    const { jar } = await signedInUser();
    assert.equal((await resolveAccess(scope(), req(jar).headers)).status, "unassigned");
    assert.equal((await h.q("select 1 from user_role")).length, 0);
  });

  it("the session cookie carries no role or user data (Better Auth's cookie cache is off)", opts, async () => {
    const { jar, userId } = await signedInUser();
    await grantRole(userId, "ADMIN");
    const value = decodeURIComponent(jar.header().split("=").slice(1).join("="));
    assert.ok(!/ADMIN|student\.one|roles/i.test(value));
    assert.ok(!/ADMIN|student\.one|roles/i.test(Buffer.from(value.split(".")[0], "base64url").toString("utf8")));
  });
});

describe("convener access needs the role AND an active membership of that committee", () => {
  it("evaluates role/membership combinations", opts, async () => {
    const { jar, userId } = await signedInUser();
    const media = await committee("MEDIA");
    const robotics = await committee("ROBOTICS");
    const dormant = await committee("DORMANT", false);

    // Membership without the role: no access (and not even an assigned user).
    await member(userId, media, true, "MEMBER");
    let access = await resolveAccess(scope(), req(jar).headers);
    assert.equal(access.status, "unassigned");

    // Role + active membership of MEDIA only.
    await grantRole(userId, "CONVENER");
    access = await resolveAccess(scope(), req(jar).headers);
    assert.ok(access.status === "ok");
    assert.equal(canActForCommittee(access.user, media), true);
    assert.equal(canActForCommittee(access.user, robotics), false, "another committee: denied");

    // Deactivated membership and inactive committee do not count.
    await h.q("update committee_membership set is_active = false");
    access = await resolveAccess(scope(), req(jar).headers);
    assert.ok(access.status === "ok" && !canActForCommittee(access.user, media));
    await h.q("update committee_membership set is_active = true");
    await member(userId, dormant, true, "CONVENER");
    access = await resolveAccess(scope(), req(jar).headers);
    assert.ok(access.status === "ok");
    assert.equal(canActForCommittee(access.user, dormant), false, "inactive committee: denied");
    assert.equal(canActForCommittee(access.user, media), true);
  });
});

describe("deactivation, session invalidation and API guards", () => {
  it("a deactivated user loses access at once and cannot use the old cookie", opts, async () => {
    const { jar, userId } = await signedInUser();
    await grantRole(userId, "ADMIN");
    assert.equal((await resolveAccess(scope(), req(jar).headers)).status, "ok");
    await h.q("update app_user set is_active = false where id = $1", [userId]);
    const access = await resolveAccess(scope(), req(jar).headers);
    assert.notEqual(access.status, "ok");
    const err = await thrown(requireRole(scope(), req(jar), ["ADMIN"]));
    assert.ok(isRedirectResponse(err, "/login") || isRedirectResponse(err, "/login?error=inactive"));
  });

  it("an inactive user whose session somehow survives is still refused, and the session is deleted", opts, async () => {
    const { jar, userId } = await signedInUser();
    await grantRole(userId, "ADMIN");
    // Bypass the invalidation trigger to simulate a surviving session.
    await h.q("alter table app_user disable trigger app_user_expire_sessions_on_deactivation");
    try {
      await h.q("update app_user set is_active = false where id = $1", [userId]);
      // The first check refuses the inactive user and removes the surviving session...
      assert.ok(isRedirectResponse(await thrown(requireRole(scope(), req(jar), ["ADMIN"])), "/login?error=inactive"));
      assert.equal((await h.q("select 1 from auth_session")).length, 0, "the surviving session is removed");
      // ...so the same cookie is simply unknown afterwards.
      assert.equal((await resolveAccess(scope(), req(jar).headers)).status, "anonymous");
    } finally {
      await h.q("alter table app_user enable trigger app_user_expire_sessions_on_deactivation");
    }
  });

  it(
    "defense in depth: a session older than 30 days is refused even if the database cap were bypassed",
    opts,
    async () => {
      const { jar, userId } = await signedInUser();
      await grantRole(userId, "ADMIN");
      await h.q("alter table auth_session disable trigger auth_session_cap_lifetime");
      try {
        await h.q(
          "update auth_session set created_at = now() - interval '31 days', expires_at = now() + interval '3 days'",
        );
      } finally {
        await h.q("alter table auth_session enable trigger auth_session_cap_lifetime");
      }
      assert.equal((await resolveAccess(scope(), req(jar).headers)).status, "anonymous");
      assert.equal((await h.q("select 1 from auth_session")).length, 0);
    },
  );

  it(
    "API guards answer 401 for anonymous, 403 for unassigned or wrong role, and return the user otherwise",
    opts,
    async () => {
      const anon = await thrown(requireApiRole(scope(), req(), ["ADMIN"]));
      assert.ok(anon instanceof ApiError && anon.status === 401);

      const { jar, userId } = await signedInUser();
      const unassigned = await thrown(requireApiRole(scope(), req(jar), ["ADMIN"]));
      assert.ok(unassigned instanceof ApiError && unassigned.status === 403);

      await grantRole(userId, "REVIEWER");
      const wrong = await thrown(requireApiRole(scope(), req(jar), ["ADMIN"]));
      assert.ok(wrong instanceof ApiError && wrong.status === 403);
      assert.equal((await requireApiRole(scope(), req(jar), ["REVIEWER", "ADMIN"])).roles[0], "REVIEWER");
    },
  );

  it("logging out invalidates the session for every later check", opts, async () => {
    const { jar, userId } = await signedInUser();
    await grantRole(userId, "ADMIN");
    const res = await h.auth.api.signOut({
      headers: new Headers({ cookie: jar.header(), origin: h.baseURL }),
      asResponse: true,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await resolveAccess(scope(), req(jar).headers), { status: "anonymous" });
  });
});

describe("request hygiene", () => {
  it("rejects a state-changing post from a foreign origin, allows our own or none", () => {
    const r = (origin?: string) =>
      new Request("http://localhost:5173/logout", { method: "POST", headers: origin ? { origin } : {} });
    assert.doesNotThrow(() => assertSameOrigin(r("http://localhost:5173"), "http://localhost:5173"));
    assert.doesNotThrow(() => assertSameOrigin(r(), "http://localhost:5173"));
    for (const evil of [
      "https://evil.example",
      "http://localhost:5174",
      "null",
      "http://localhost:5173.evil.example",
    ]) {
      const err = (() => {
        try {
          assertSameOrigin(r(evil), "http://localhost:5173");
        } catch (e) {
          return e;
        }
      })();
      assert.equal((err as { init?: { status?: number } })?.init?.status, 403, evil);
    }
  });
});
