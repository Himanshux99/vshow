import assert from "node:assert/strict";
import { describe, it } from "node:test";
import pg from "pg";
import { SeedGuardError, assertSeedAllowed } from "../scripts/lib/seed-guard.ts";
import { SEED_EMAIL_DOMAIN, SEED_REF_PREFIX, buildFixtures } from "../scripts/seed/fixtures.ts";
import { createThrowawayDb, runNode } from "./helpers.ts";

const LOCAL = "postgresql://vshow:s3cretpw@127.0.0.1:5432/vshow";
const NEON = "postgresql://u:s3cretpw@ep-x-1.eu.aws.neon.tech/neondb?sslmode=require";
const ok = { APP_ENV: "development", DB_TARGET: "local", DATABASE_URL: LOCAL };

const refused = (env: Record<string, string | undefined>, pattern: RegExp) =>
  assert.throws(
    () => assertSeedAllowed(env),
    (e: unknown) => {
      assert.ok(e instanceof SeedGuardError, `expected SeedGuardError, got ${e}`);
      assert.match(e.message, pattern);
      assert.ok(!e.message.includes("s3cretpw"));
      return true;
    },
  );

describe("seed guard (fail closed)", () => {
  it("allows development and test against a local database", () => {
    assert.equal(assertSeedAllowed(ok).host, "127.0.0.1");
    assert.equal(assertSeedAllowed({ ...ok, APP_ENV: "test" }).database, "vshow");
  });

  it("rejects unset, production, preview and unknown environments", () => {
    refused({ ...ok, APP_ENV: undefined }, /APP_ENV is not set/);
    refused({ ...ok, APP_ENV: "" }, /APP_ENV is not set/);
    for (const v of ["production", "preview", "staging", "Development", "dev"]) {
      refused({ ...ok, APP_ENV: v }, /not allowed/);
    }
  });

  it("rejects production runtime markers even if APP_ENV looks fine", () => {
    refused({ ...ok, NODE_ENV: "production" }, /NODE_ENV=production/);
    refused({ ...ok, VERCEL_ENV: "preview" }, /Vercel/);
    refused({ ...ok, VERCEL: "1" }, /Vercel/);
  });

  it("rejects remote, unknown and ambiguous database targets", () => {
    refused(
      { ...ok, DB_TARGET: "neon", DATABASE_URL: NEON },
      /(not 'local'|not the local database|not a loopback host)/,
    );
    refused({ ...ok, DB_TARGET: undefined }, /DB_TARGET is 'unset'/);
    refused({ ...ok, DB_TARGET: "prod" }, /not 'local'/);
    refused({ ...ok, DATABASE_URL: NEON }, /not a loopback host/);
    refused({ ...ok, DATABASE_URL: undefined }, /DATABASE_URL is not set/);
    // runtime URL remote while the direct URL is local
    refused({ ...ok, DATABASE_URL: NEON, DATABASE_URL_DIRECT: LOCAL }, /different databases/);
    refused({ ...ok, DATABASE_URL: LOCAL.replace(/vshow$/, "vshow_production") }, /not the expected local database/);
  });
});

describe("seed fixtures integrity (no database)", () => {
  const f = buildFixtures();
  const all = Object.entries(f).filter(([k]) => k !== "currentVersions") as Array<
    [string, Array<Record<string, unknown>>]
  >;

  it("is deterministic", () => {
    assert.deepEqual(buildFixtures(), f);
  });

  it("has unique ids and natural keys", () => {
    for (const [name, rows] of all) {
      if (name === "userRoles") continue;
      assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, `duplicate id in ${name}`);
    }
    for (const col of ["email", "vauth_subject"])
      assert.equal(new Set(f.users.map((r) => r[col])).size, f.users.length);
    for (const col of ["reference_code", "title"])
      assert.equal(new Set(f.submissions.map((r) => r[col])).size, f.submissions.length);
    assert.equal(new Set(f.mediaVersions.map((r) => r.object_key)).size, f.mediaVersions.length);
  });

  it("is clearly synthetic", () => {
    assert.ok(
      f.users.every(
        (u) => String(u.email).endsWith(`@${SEED_EMAIL_DOMAIN}`) && String(u.display_name).startsWith("[SEED]"),
      ),
    );
    assert.ok(f.submissions.every((s) => String(s.reference_code).startsWith(SEED_REF_PREFIX)));
    assert.ok(f.committees.every((c) => String(c.code).startsWith("SEED-")));
    assert.ok(f.screens.every((c) => String(c.code).startsWith("SEED-")));
    assert.ok(f.mediaVersions.every((v) => String(v.object_key).startsWith("seed/")));
    assert.ok(f.auditEvents.every((a) => JSON.parse(String(a.metadata)).synthetic === true));
  });

  it("keeps every reference inside the fixture set and versions inside their submission", () => {
    const set = (rows: Array<Record<string, unknown>>) => new Set(rows.map((r) => r.id));
    const users = set(f.users),
      subs = set(f.submissions),
      screens = set(f.screens),
      comms = set(f.committees);
    const versionSub = new Map(f.mediaVersions.map((v) => [v.id, v.submission_id]));
    assert.ok(f.submissions.every((s) => comms.has(s.committee_id) && users.has(s.created_by_user_id)));
    assert.ok(f.mediaVersions.every((v) => subs.has(v.submission_id) && users.has(v.uploaded_by_user_id)));
    assert.ok(f.screenRequests.every((r) => subs.has(r.submission_id) && screens.has(r.screen_id)));
    for (const r of [...f.reviewDecisions, ...f.scheduleEntries])
      assert.equal(versionSub.get(r.media_version_id), r.submission_id);
    assert.ok(f.currentVersions.every((c) => versionSub.get(c.versionId) === c.submissionId));
    assert.ok(
      f.auditEvents.every((a) => users.has(a.actor_user_id) && (a.submission_id === null || subs.has(a.submission_id))),
    );
  });

  it("covers the required workflow scenarios", () => {
    const status = (s: string) => f.submissions.filter((x) => x.workflow_status === s).length;
    for (const s of ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED"]) assert.ok(status(s) >= 1, s);
    assert.ok(f.reviewDecisions.some((r) => r.decision === "REJECTED" && r.comment));
    assert.ok(f.reviewDecisions.some((r) => r.decision === "CHANGES_REQUESTED" && r.comment));
    const versionsPer = new Map<unknown, number>();
    f.mediaVersions.forEach((v) => versionsPer.set(v.submission_id, (versionsPer.get(v.submission_id) ?? 0) + 1));
    assert.ok(
      [...versionsPer.values()].some((n) => n >= 2),
      "version history",
    );
  });
});

describe("seeding a disposable local database", async () => {
  const db = await createThrowawayDb("vshow_test_seed");
  const opts = { skip: db.skipReason || false };
  const env = (extra: Record<string, string> = {}) => ({
    APP_ENV: "test",
    DB_TARGET: "local",
    DATABASE_URL: db.url,
    DATABASE_URL_DIRECT: "",
    ...extra,
  });
  const q = async <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) => {
    const c = new pg.Client({ connectionString: db.url });
    await c.connect();
    try {
      return (await c.query<T>(sql, params)).rows;
    } finally {
      await c.end();
    }
  };
  const counts = async () => {
    const tables = [
      "app_role",
      "app_user",
      "user_role",
      "committee",
      "committee_membership",
      "screen",
      "submission",
      "media_version",
      "screen_request",
      "review_decision",
      "schedule_entry",
      "audit_event",
    ];
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = Number((await q(`select count(*)::int as n from ${t}`))[0].n);
    return out;
  };
  const unrelated = async () =>
    JSON.stringify(
      await q(
        "select 'u' k, id::text, email x, display_name y from app_user where email = 'real.person@example.org' " +
          "union all select 'c', id::text, code, name from committee where code = 'REAL-COMMITTEE' " +
          "union all select 'r', id::text, code, name from app_role where code = 'ADMIN' order by 1, 2",
      ),
    );

  it("refuses to seed an unmigrated database", opts, () => {
    const r = runNode(["scripts/db-seed.ts"], env());
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not fully migrated/);
  });

  it("first run creates the fixtures next to unrelated data", opts, async () => {
    assert.equal(runNode(["scripts/db-migrate.ts"], env()).status, 0);
    await q("insert into app_user(email, display_name) values ('real.person@example.org', 'Unrelated Person')");
    await q("insert into committee(name, code) values ('Unrelated', 'REAL-COMMITTEE')");
    await q("insert into app_role(code, name) values ('ADMIN', 'Pre-existing Admin Role')");
    const before = await unrelated();
    const r = runNode(["scripts/db-seed.ts"], env());
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /Seed complete/);
    const c = await counts();
    assert.equal(c.submission, 7);
    assert.equal(c.app_user, 9); // 8 seed users + 1 unrelated
    assert.equal(c.app_role, 4);
    assert.equal(c.committee, 3);
    assert.equal(await unrelated(), before, "unrelated rows must be untouched (including the pre-existing ADMIN role)");
  });

  it("second run changes nothing", opts, async () => {
    const before = {
      counts: await counts(),
      unrelated: await unrelated(),
      state: JSON.stringify(await q("select * from submission order by id")),
    };
    const r = runNode(["scripts/db-seed.ts"], env());
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.doesNotMatch(r.stdout, /\+[1-9]\d* new/);
    assert.deepEqual(await counts(), before.counts);
    assert.equal(await unrelated(), before.unrelated);
    assert.equal(JSON.stringify(await q("select * from submission order by id")), before.state);
  });

  it("does not overwrite a developer's edits to seed rows on re-run", opts, async () => {
    await q("update submission set title = 'edited by dev' where reference_code = 'SEED-0001'");
    assert.equal(runNode(["scripts/db-seed.ts"], env()).status, 0);
    assert.equal(
      (await q("select title from submission where reference_code = 'SEED-0001'"))[0].title,
      "edited by dev",
    );
    await q("update submission set title = '[SEED] Welcome Week Poster (draft)' where reference_code = 'SEED-0001'");
  });

  it("produces consistent workflow data and role boundaries", opts, async () => {
    // Every current version belongs to its submission (composite FK) and exists.
    const cv = await q(
      "select count(*)::int n from submission s join media_version v on v.id = s.current_version_id and v.submission_id = s.id",
    );
    assert.equal(cv[0].n, 7);
    // APPROVED submissions are approved on their CURRENT version; stale approvals are not eligible.
    const eligible = await q(`select reference_code from submission s where workflow_status = 'APPROVED'
      and exists (select 1 from review_decision d where d.media_version_id = s.current_version_id and d.decision = 'APPROVED') order by 1`);
    assert.deepEqual(
      eligible.map((r) => r.reference_code),
      ["SEED-0003", "SEED-0007"],
    );
    const stale =
      await q(`select reference_code from submission s where exists (select 1 from review_decision d where d.submission_id = s.id and d.decision = 'APPROVED')
      and not exists (select 1 from review_decision d where d.media_version_id = s.current_version_id and d.decision = 'APPROVED') order by 1`);
    assert.deepEqual(
      stale.map((r) => r.reference_code),
      ["SEED-0006"],
    );
    // Approved media awaiting handoff: approved on current version, no live schedule entry.
    const awaiting = await q(`select reference_code from submission s where workflow_status = 'APPROVED'
      and not exists (select 1 from schedule_entry e where e.submission_id = s.id and e.status <> 'CANCELLED')`);
    assert.deepEqual(
      awaiting.map((r) => r.reference_code),
      ["SEED-0003"],
    );
    // Requested windows are stored separately from actual schedule windows.
    const split =
      await q(`select count(*)::int n from schedule_entry e join screen_request r on r.submission_id = e.submission_id and r.screen_id = e.screen_id and r.slot_number = 1
      where e.actual_start_at <> r.preferred_start_at`);
    assert.equal(split[0].n, 1);
    // Boundaries: effective convener = active user + CONVENER role + ACTIVE membership.
    const effective = await q(`select u.email, c.code from app_user u
      join user_role ur on ur.user_id = u.id join app_role r on r.id = ur.role_id and r.code = 'CONVENER'
      join committee_membership m on m.user_id = u.id and m.is_active
      join committee c on c.id = m.committee_id where u.is_active and u.email like '%@seed.vshow.invalid' order by 1`);
    assert.deepEqual(
      effective.map((r) => `${String(r.email).split("@")[0]}:${r.code}`),
      ["convener_media:SEED-MEDIA", "convener_robotics:SEED-ROBOTICS"],
    );
  });

  it("rejects unsafe targets without touching the database", opts, async () => {
    const before = await counts();
    const unsafe: Array<Record<string, string>> = [
      { APP_ENV: "production" },
      { APP_ENV: "preview" },
      { APP_ENV: "staging" },
      { APP_ENV: "" },
      { NODE_ENV: "production" },
      { VERCEL_ENV: "production" },
    ];
    for (const bad of unsafe) {
      const r = runNode(["scripts/db-seed.ts"], env(bad));
      assert.equal(r.status, 1, JSON.stringify(bad));
      assert.match(r.stderr, /Seeding refused/);
    }
    const remote = runNode(
      ["scripts/db-seed.ts"],
      env({
        DB_TARGET: "neon",
        DATABASE_URL: "postgresql://u:s3cretpw@ep-x-1.eu.aws.neon.tech/neondb?sslmode=require",
      }),
    );
    assert.equal(remote.status, 1);
    assert.match(remote.stderr, /Seeding refused/);
    assert.ok(!(remote.stdout + remote.stderr).includes("s3cretpw"));
    assert.deepEqual(await counts(), before);
  });

  it("removal needs confirmation and deletes only seed-owned rows", opts, async () => {
    assert.equal(runNode(["scripts/db-seed.ts", "--remove"], env()).status, 1);
    assert.equal(runNode(["scripts/db-seed.ts", "--remove", "--confirm=wrong"], env()).status, 1);
    assert.equal((await counts()).submission, 7);
    const dbName = new URL(db.url).pathname.slice(1);
    const r = runNode(["scripts/db-seed.ts", "--remove", `--confirm=${dbName}`], env());
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const c = await counts();
    assert.deepEqual([c.submission, c.media_version, c.audit_event, c.app_user, c.committee], [0, 0, 0, 1, 1]);
    assert.equal(c.app_role, 4);
    assert.match(await unrelated(), /real\.person@example\.org/);
    // Re-seeding after removal works.
    assert.equal(runNode(["scripts/db-seed.ts"], env()).status, 0);
    assert.equal((await counts()).submission, 7);
  });

  it("removal rolls back if other data references seed rows", opts, async () => {
    await q(`insert into audit_event(actor_user_id, action, entity_type, entity_id, submission_id)
      select u.id, 'DEV_NOTE', 'SUBMISSION', s.id, s.id from app_user u, submission s where u.email = 'reviewer@seed.vshow.invalid' and s.reference_code = 'SEED-0001'`);
    const dbName = new URL(db.url).pathname.slice(1);
    const r = runNode(["scripts/db-seed.ts", "--remove", `--confirm=${dbName}`], env());
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nothing was removed/);
    assert.equal((await counts()).submission, 7);
  });

  it("cleanup", async () => {
    await db.drop();
  });
});
