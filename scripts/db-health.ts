// Real database health check: connects and runs harmless read-only queries.
// Usage: npm run db:health [-- --direct]   (--direct checks the migration connection)
import { DbConfigError, resolveDbConfig } from "../app/db/config.server.ts";
import { connect, describeError, fail, readLocalMigrations, readMigrationState } from "./lib/db-runtime.ts";

const purpose = process.argv.includes("--direct") ? "migration" : "runtime";

let config;
try {
  config = resolveDbConfig(process.env, purpose);
} catch (err) {
  if (err instanceof DbConfigError) fail(err.message);
  throw err;
}

const client = await connect(config);
try {
  const info = await client.query(
    "select 1 as ok, current_database() as db, current_setting('server_version') as version",
  );
  if (info.rows[0].ok !== 1) fail("Health query returned an unexpected result.");
  const local = readLocalMigrations();
  const state = await readMigrationState(client, local);

  console.log(`✔ Connected to ${config.host}:${config.port}/${info.rows[0].db} (PostgreSQL ${info.rows[0].version}, ${purpose} connection)`);
  console.log(
    state.tableExists
      ? `✔ Migrations: ${state.applied} applied, ${state.pending.length} pending (of ${local.length} committed)`
      : `! No migration history yet: ${local.length} pending. Run \`npm run db:migrate\` explicitly.`,
  );
  if (state.unknownApplied.length) {
    console.log(`✖ ${state.unknownApplied.length} applied migration(s) do not match committed files (history mismatch).`);
    process.exitCode = 1;
  }
} catch (err) {
  fail(`Health check failed: ${describeError(err, config.url)}`);
} finally {
  await client.end().catch(() => {});
}
