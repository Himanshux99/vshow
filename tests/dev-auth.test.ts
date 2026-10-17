// Local development identity switcher (Stage D). It must work for seeded identities, go through Better
// Auth's normal session machinery and Vshow's normal authorization, and be impossible to reach otherwise.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildAuth } from "../app/auth/auth.server.ts";
import { canActForCommittee, resolveAccess } from "../app/auth/authorize.server.ts";
import { DEV_IDENTITY_KEYS } from "../app/auth/dev-switcher.server.ts";
import { runNode } from "./helpers.ts";
import { CookieJar, createAuthHarness, type AuthHarness } from "./support/auth-harness.ts";

const h: AuthHarness = await createAuthHarness({ devAuth: { enabled: true } });
const opts = { skip: h.skipReason || false };

before(() => {
  if (h.skipReason) return;
  const seed = runNode(["scripts/db-seed.ts"], { DB_TARGET: "local", DATABASE_URL: h.dbUrl, DATABASE_URL_DIRECT: "" });
  assert.equal(seed.status, 0, seed.stderr || seed.stdout);
});
after(async () => {
  if (!h.skipReason) await h.close();
});

const scope = () => ({
  auth: { devAuth: { enabled: true }, config: () => h.config, get: () => h.auth },
  database: h.database,
  logger: h.log.logger,
});

async function switchTo(identity: unknown, extra: Record<string, unknown> = {}) {
  const res = await h.auth.handler(
    new Request(`${h.baseURL}/api/auth/dev/sign-in`, {
      method: "POST",
      headers: { origin: h.baseURL, "content-type": "application/json" },
      body: JSON.stringify({ identity, ...extra }),
    }),
  );
  const jar = new CookieJar();
  jar.add(res.headers.getSetCookie());
  return { res, jar };
}
const access = (jar: CookieJar) => resolveAccess(scope(), new Headers({ cookie: jar.header() }));

describe("the switcher exists only when enabled", () => {
  it("is registered when every guard passed", opts, () => {
    assert.ok("devSignIn" in h.auth.api);
  });

  it("is completely absent when disabled: no endpoint, 404 over HTTP", opts, async () => {
    const off = buildAuth({
      config: h.config,
      database: h.database,
      logger: h.log.logger,
      devAuth: { enabled: false },
    });
    assert.ok(!("devSignIn" in off.api));
    assert.ok(!Object.values(off.api).some((e) => (e as { path?: string }).path?.includes("/dev/")));
    const res = await off.handler(
      new Request(`${h.baseURL}/api/auth/dev/sign-in`, {
        method: "POST",
        headers: { origin: h.baseURL, "content-type": "application/json" },
        body: JSON.stringify({ identity: "admin" }),
      }),
    );
    assert.equal(res.status, 404);
  });
});

describe("local development before Vshow is registered with vauth (no OAuth client configured)", () => {
  it("the vauth provider is absent while the switcher still works", opts, async () => {
    const noOauth = buildAuth({
      config: { ...h.config, oauth: null },
      database: h.database,
      logger: h.log.logger,
      devAuth: { enabled: true },
    });
    assert.ok(!("signInWithOAuth2" in noOauth.api), "no OAuth sign-in endpoint");
    assert.ok(!("oAuth2Callback" in noOauth.api), "no OAuth callback endpoint");
    assert.ok("devSignIn" in noOauth.api);
    const res = await noOauth.handler(
      new Request(`${h.baseURL}/api/auth/dev/sign-in`, {
        method: "POST",
        headers: { origin: h.baseURL, "content-type": "application/json" },
        body: JSON.stringify({ identity: "admin" }),
      }),
    );
    assert.equal(res.status, 200);
  });
});

describe("signing in as a seeded identity", () => {
  it("each fixed key creates a normal Better Auth session for exactly that seeded user", opts, async () => {
    for (const key of DEV_IDENTITY_KEYS.filter((k) => k !== "inactive_convener")) {
      const { res, jar } = await switchTo(key);
      assert.equal(res.status, 200, key);
      assert.ok(jar.names().includes("vshow.session_token"), `${key}: the normal session cookie`);
      const session = await h.getSession(jar);
      assert.equal(session?.user.email, `${key}@seed.vshow.invalid`);
    }
  });

  it("roles and memberships are still resolved from the database (the switcher grants nothing)", opts, async () => {
    const expectations: Record<string, { status: string; roles: string[] }> = {
      admin: { status: "ok", roles: ["ADMIN"] },
      reviewer: { status: "ok", roles: ["REVIEWER"] },
      manager: { status: "ok", roles: ["SERVER_ROOM_MANAGER"] },
      convener_media: { status: "ok", roles: ["CONVENER"] },
      convener_robotics: { status: "ok", roles: ["CONVENER"] },
      convener_lapsed: { status: "ok", roles: ["CONVENER"] },
      member_media: { status: "unassigned", roles: [] },
    };
    for (const [key, want] of Object.entries(expectations)) {
      const a = await access((await switchTo(key)).jar);
      assert.equal(a.status, want.status, key);
      assert.deepEqual("user" in a ? a.user.roles : [], want.roles, key);
    }
  });

  it("the committee boundaries of the seeded identities hold", opts, async () => {
    const [media] = await h.q<{ id: string }>("select id from committee where code='SEED-MEDIA'");
    const [robotics] = await h.q<{ id: string }>("select id from committee where code='SEED-ROBOTICS'");
    const user = async (key: string) => {
      const a = await access((await switchTo(key)).jar);
      assert.ok(a.status === "ok", key);
      return a.user;
    };
    assert.equal(canActForCommittee(await user("convener_media"), media.id), true);
    assert.equal(canActForCommittee(await user("convener_media"), robotics.id), false);
    assert.equal(canActForCommittee(await user("convener_robotics"), robotics.id), true);
    assert.equal(canActForCommittee(await user("convener_lapsed"), media.id), false, "lapsed membership: no access");
    assert.equal(canActForCommittee(await user("admin"), media.id), false, "admin is not an operational convener");
  });

  it("an inactive seeded identity is refused like any inactive user, and gets no session", opts, async () => {
    const before = (await h.q("select count(*)::int n from auth_session"))[0].n;
    const { res, jar } = await switchTo("inactive_convener");
    assert.equal(res.status, 403);
    assert.equal(jar.names().length, 0);
    assert.equal((await h.q("select count(*)::int n from auth_session"))[0].n, before);
  });

  it("deactivating an identity mid-session ends it (same hook and trigger as regular users)", opts, async () => {
    const { jar } = await switchTo("reviewer");
    assert.equal((await access(jar)).status, "ok");
    await h.q("update app_user set is_active = false where email = 'reviewer@seed.vshow.invalid'");
    assert.notEqual((await access(jar)).status, "ok");
    assert.equal((await switchTo("reviewer")).res.status, 403);
    await h.q("update app_user set is_active = true where email = 'reviewer@seed.vshow.invalid'");
  });
});

describe("the browser can only choose from the fixed list", () => {
  it("rejects anything that is not a known key", opts, async () => {
    const bad = [
      "someone@vit.edu.in",
      "ADMIN",
      "Admin",
      "admin@seed.vshow.invalid",
      "",
      "  admin",
      "../admin",
      7,
      null,
      {},
      ["admin"],
    ];
    for (const value of bad) {
      const { res, jar } = await switchTo(value);
      assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(value)} -> ${res.status}`);
      assert.equal(jar.names().length, 0);
    }
    const missing = await h.auth.handler(
      new Request(`${h.baseURL}/api/auth/dev/sign-in`, {
        method: "POST",
        headers: { origin: h.baseURL, "content-type": "application/json" },
        body: "{}",
      }),
    );
    assert.ok(missing.status >= 400 && missing.status < 500);
  });

  it("ignores any user ID, role or email smuggled into the request", opts, async () => {
    const [admin] = await h.q<{ id: string }>("select id from app_user where email='admin@seed.vshow.invalid'");
    const { res, jar } = await switchTo("reviewer", {
      userId: admin.id,
      id: admin.id,
      role: "ADMIN",
      roles: ["ADMIN"],
      email: "admin@seed.vshow.invalid",
    });
    assert.equal(res.status, 200);
    const a = await access(jar);
    assert.ok(a.status === "ok");
    assert.equal(a.user.email, "reviewer@seed.vshow.invalid");
    assert.deepEqual(a.user.roles, ["REVIEWER"]);
  });

  it("requires BOTH seed markers in the database: the .invalid email and a seed-<key> subject", opts, async () => {
    await h.q("alter table app_user disable trigger app_user_protect_vauth_subject");
    try {
      await h.q("update app_user set vauth_subject = 'real-vauth-sub' where email = 'manager@seed.vshow.invalid'");
      assert.equal((await switchTo("manager")).res.status, 404);
      await h.q("update app_user set vauth_subject = null where email = 'manager@seed.vshow.invalid'");
      assert.equal((await switchTo("manager")).res.status, 404);
      await h.q("update app_user set vauth_subject = 'seed-manager' where email = 'manager@seed.vshow.invalid'");
      assert.equal((await switchTo("manager")).res.status, 200);
    } finally {
      await h.q("alter table app_user enable trigger app_user_protect_vauth_subject");
    }
  });

  it("is protected against cross-site requests by Better Auth's origin check", opts, async () => {
    const res = await h.auth.handler(
      new Request(`${h.baseURL}/api/auth/dev/sign-in`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ identity: "admin" }),
      }),
    );
    assert.equal(res.status, 403);
    assert.equal(res.headers.getSetCookie().length, 0);
  });
});

describe("seeded identities cannot be reached through the real vauth sign-in path", () => {
  const seedCount = async () =>
    (await h.q("select count(*)::int n from app_user where email like '%@seed.vshow.invalid'"))[0].n;

  it("a provider claiming a .invalid address is denied, and the seeded user is untouched", opts, async () => {
    h.idp.reset();
    Object.assign(h.idp.tweaks.profile, { sub: "whatever-sub", email: "admin@seed.vshow.invalid" });
    const before = await seedCount();
    const r = await h.signIn();
    assert.ok(r.errorCode);
    assert.equal(r.jar.names().filter((n) => n.includes("session_token")).length, 0);
    assert.equal(await seedCount(), before);
    const [admin] = await h.q(
      "select vauth_subject, email_verified from app_user where email='admin@seed.vshow.invalid'",
    );
    assert.equal(admin.vauth_subject, "seed-admin");
    assert.equal((await h.q("select 1 from auth_account")).length, 0);
  });

  it("a provider using a seed subject with an allowed email cannot take over the seeded identity", opts, async () => {
    h.idp.reset();
    Object.assign(h.idp.tweaks.profile, { sub: "seed-admin", email: "attacker@vit.edu.in", name: "Attacker" });
    const r = await h.signIn();
    assert.ok(r.errorCode, "the database refuses a subject that already belongs to a seeded user");
    assert.equal((await h.q("select 1 from app_user where email='attacker@vit.edu.in'")).length, 0, "no orphan user");
    assert.equal((await h.q("select 1 from auth_account")).length, 0);
    const a = await access((await switchTo("admin")).jar);
    assert.ok(a.status === "ok" && a.user.roles.includes("ADMIN"));
  });
});

describe("a production build refuses the switcher flag", () => {
  const build = (flag: string | undefined) =>
    runNode(["node_modules/@react-router/dev/bin.cjs", "build"], { VSHOW_DEV_AUTH: flag ?? "" });

  it("fails the build, with an explanation, when VSHOW_DEV_AUTH is set to anything", () => {
    for (const flag of ["1", "true", "0"]) {
      const r = build(flag);
      assert.notEqual(r.status, 0, `flag=${flag} must fail the build`);
      assert.match(r.stderr + r.stdout, /VSHOW_DEV_AUTH is set during a production build/);
    }
  });
});
