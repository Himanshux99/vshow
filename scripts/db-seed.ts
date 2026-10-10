// Explicit, local-only development seeding with synthetic data. Never run by dev/build/start/migrate.
// Usage: npm run db:seed                         insert missing fixtures (idempotent, never updates rows)
//        npm run db:seed -- --remove --confirm=<database name>
//                                                delete ONLY the fixture rows (by exact id); roles are kept
// Requires APP_ENV=development|test, DB_TARGET=local and a loopback database (see lib/seed-guard.ts).
import type pg from "pg";
import { redact } from "../app/db/config.server.ts";
import { connect, describeError, fail, readLocalMigrations, readMigrationState } from "./lib/db-runtime.ts";
import { SeedGuardError, assertSeedAllowed } from "./lib/seed-guard.ts";
import { ROLES, buildFixtures, seedId } from "./seed/fixtures.ts";

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const confirm = args.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);

let config;
try {
  config = assertSeedAllowed(process.env);
} catch (err) {
  if (err instanceof SeedGuardError) fail(`Seeding refused: ${err.message}`);
  throw err;
}
if (remove && confirm !== config.database) {
  fail(`--remove requires --confirm=${config.database} (the database name).`);
}

const fx = buildFixtures();
const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.id as string);

/** Multi-row INSERT ... ON CONFLICT DO NOTHING. Table/column names come from static fixtures only. */
async function insertMissing(c: pg.Client, table: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const ph = cols.map((col) => {
      params.push(row[col]);
      return `$${params.length}`;
    });
    return `(${ph.join(", ")})`;
  });
  const res = await c.query(
    `insert into "${table}" (${cols.map((x) => `"${x}"`).join(", ")}) values ${tuples.join(", ")} on conflict do nothing`,
    params,
  );
  const created = res.rowCount ?? 0;
  console.log(`  ${table.padEnd(22)} +${created} new, ${rows.length - created} already present`);
}

async function seed(c: pg.Client) {
  // Roles are shared reference data: insert if absent, then resolve ids by code.
  await insertMissing(
    c,
    "app_role",
    Object.entries(ROLES).map(([code, r]) => ({
      id: seedId(`role:${code}`),
      code,
      name: r.name,
      description: r.description,
    })),
  );
  const roleRows = await c.query("select id, code from app_role");
  const roleId = new Map(roleRows.rows.map((r) => [r.code as string, r.id as string]));

  await insertMissing(c, "app_user", fx.users);
  await insertMissing(
    c,
    "user_role",
    fx.userRoles.map(({ role_code, ...rest }) => ({ ...rest, role_id: roleId.get(role_code as string) })),
  );
  await insertMissing(c, "committee", fx.committees);
  await insertMissing(c, "committee_membership", fx.memberships);
  await insertMissing(c, "screen", fx.screens);
  await insertMissing(c, "submission", fx.submissions);
  await insertMissing(c, "media_version", fx.mediaVersions);
  // The composite FK needs the version to exist first; only fill a still-empty pointer.
  for (const { submissionId, versionId } of fx.currentVersions) {
    await c.query("update submission set current_version_id = $2 where id = $1 and current_version_id is null", [
      submissionId,
      versionId,
    ]);
  }
  await insertMissing(c, "screen_request", fx.screenRequests);
  await insertMissing(c, "review_decision", fx.reviewDecisions);
  await insertMissing(c, "schedule_entry", fx.scheduleEntries);
  await insertMissing(c, "audit_event", fx.auditEvents);
}

async function removeSeed(c: pg.Client) {
  const del = async (table: string, col: string, list: string[]) => {
    const res = await c.query(`delete from "${table}" where "${col}" = any($1::uuid[])`, [list]);
    console.log(`  ${table.padEnd(22)} -${res.rowCount ?? 0}`);
  };
  const subs = fx.submissions.map((r) => r.id as string);
  await del("audit_event", "id", ids(fx.auditEvents));
  await del("schedule_entry", "id", ids(fx.scheduleEntries));
  await del("review_decision", "id", ids(fx.reviewDecisions));
  await del("screen_request", "id", ids(fx.screenRequests));
  await c.query("update submission set current_version_id = null where id = any($1::uuid[])", [subs]);
  await del("media_version", "id", ids(fx.mediaVersions));
  await del("submission", "id", subs);
  await del("committee_membership", "id", ids(fx.memberships));
  await del("user_role", "user_id", ids(fx.users));
  await del("committee", "id", ids(fx.committees));
  await del("screen", "id", ids(fx.screens));
  await del("app_user", "id", ids(fx.users));
  console.log("  app_role               kept (shared reference data)");
}

console.log(
  `Target: ${config.target} → ${config.host}:${config.port}/${config.database} (APP_ENV=${process.env.APP_ENV})`,
);
const client = await connect(config);
try {
  const state = await readMigrationState(client, readLocalMigrations());
  if (!state.tableExists || state.pending.length || state.unknownApplied.length) {
    fail("Database schema is not fully migrated. Run `npm run db:migrate` first; nothing was seeded.");
  }
  console.log(remove ? "Removing seed-owned records:" : "Seeding synthetic data:");
  await client.query("begin");
  try {
    await (remove ? removeSeed(client) : seed(client));
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  }
  console.log(remove ? "✔ Seed records removed." : "✔ Seed complete (existing rows were left untouched).");
} catch (err) {
  process.exitCode = 1;
  const hint = remove
    ? " Other data references seed records; nothing was removed (rolled back)."
    : " Rolled back; no partial data.";
  console.error(
    `✖ ${remove ? "Removal" : "Seeding"} failed: ${redact(describeError(err, config.url), config.url)}.${hint}`,
  );
} finally {
  await client.end().catch(() => {});
}
