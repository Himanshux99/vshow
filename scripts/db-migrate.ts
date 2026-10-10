// Explicit, forward-only migration runner. Never invoked by the app or by dev/build/start scripts.
// Usage: npm run db:migrate [-- --dry-run] [-- --confirm-host=<host>] [-- --allow-destructive]
//   --dry-run            show what would be applied; change nothing
//   --confirm-host=<h>   REQUIRED for any non-local database; must equal the target host exactly
//   --allow-destructive  permit pending migrations containing DROP TABLE/COLUMN/SCHEMA, TRUNCATE, DELETE
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { DbConfigError, resolveDbConfig } from "../app/db/config.server.ts";
import {
  MIGRATIONS_DIR, connect, describeError, fail, readLocalMigrations, readMigrationState,
} from "./lib/db-runtime.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allowDestructive = args.includes("--allow-destructive");
const confirmHost = args.find((a) => a.startsWith("--confirm-host="))?.slice("--confirm-host=".length);

const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i;
const ADVISORY_LOCK_KEY = 727274; // arbitrary constant: serializes concurrent migrators

let config;
try {
  config = resolveDbConfig(process.env, "migration");
} catch (err) {
  if (err instanceof DbConfigError) fail(err.message);
  throw err;
}

if (process.env.NODE_ENV === "production" && config.isLocal === false && !confirmHost) {
  fail("Refusing to migrate under NODE_ENV=production without --confirm-host.");
}
if (!config.isLocal && !dryRun && confirmHost !== config.host) {
  fail(
    `Target ${config.host} is a remote database. Migrating it requires explicit authorization: ` +
      `re-run with --confirm-host=${config.host} once you are sure this is the intended database.`,
  );
}

const local = readLocalMigrations();
if (local.length === 0) fail(`No migrations found in ./${MIGRATIONS_DIR}. Run \`npm run db:generate\` and commit the result.`);

console.log(`Target: ${config.target} → ${config.host}:${config.port}/${config.database}`);
const client = await connect(config);
let locked = false;
try {
  await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
  locked = true;

  const before = await readMigrationState(client, local);
  if (before.unknownApplied.length) {
    fail(
      `${before.unknownApplied.length} applied migration(s) do not match any committed file. ` +
        "Applied migrations must never be edited or removed. Restore them from Git; nothing was changed.",
    );
  }
  if (before.pending.length === 0) {
    console.log(`✔ Up to date (${before.applied} migration(s) applied).`);
  } else {
    console.log(`Pending: ${before.pending.map((m) => m.tag).join(", ")}`);
    const risky = before.pending.filter((m) => DESTRUCTIVE.test(m.sql.replace(/--.*$/gm, "")));
    if (risky.length && !allowDestructive) {
      fail(
        `Pending migration(s) contain destructive statements: ${risky.map((m) => m.tag).join(", ")}. ` +
          "Review the SQL and re-run with --allow-destructive only if intended. Nothing was changed.",
      );
    }
    if (dryRun) {
      console.log("Dry run: no changes made.");
    } else {
      await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_DIR });
      const after = await readMigrationState(client, local);
      console.log(`✔ Applied ${before.pending.length} migration(s); ${after.applied} total, ${after.pending.length} pending.`);
    }
  }
} catch (err) {
  process.exitCode = 1;
  console.error(`✖ Migration failed (the failing migration was rolled back): ${describeError(err, config.url)}`);
} finally {
  if (locked) await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
  await client.end().catch(() => {});
}
