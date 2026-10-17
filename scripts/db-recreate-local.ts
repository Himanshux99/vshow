// Drops and recreates ONLY the local development database, leaving the PostgreSQL server, its container, its data
// volume and every OTHER database in the instance untouched. Unlike `npm run db:reset:local` it does not run
// `docker compose down --volumes`.
//
// Usage:  npm run db:recreate:local                       (asks you to type the database name)
//         npm run db:recreate:local -- --confirm=vshow    (non-interactive)
//         npm run db:recreate:local -- --dry-run          (runs every check, changes nothing)
//         add --terminate-connections to also disconnect other sessions that are still using the database
//
// Safety, in order (each step refuses and exits before the next):
//   1. the shared local-target guard: DB_TARGET=local, APP_ENV set to development (or test), a loopback host, the
//      Compose port/user/database from POSTGRES_*, DATABASE_URL and DATABASE_URL_DIRECT agreeing, no shell variable
//      silently overriding .env, never Neon / production / Vercel;
//   2. for development the database must be exactly `vshow`; the automated tests may use a vshow_test_* database;
//   3. you must type the database name;
//   4. only then does it connect, to the maintenance database `postgres` (never to the target) and:
//      - refuses if other sessions are using the target, unless --terminate-connections;
//      - drops ONLY the target (DROP DATABASE; WITH (FORCE) only when --terminate-connections was given and
//        sessions exist) and recreates it with the same owner, encoding and locale.
// It never runs migrations or seeds. Afterwards: npm run db:migrate, then optionally npm run db:seed.
import { createInterface } from "node:readline/promises";
import pg from "pg";
import { redact } from "../app/db/config.server.ts";
import { describeError } from "./lib/db-runtime.ts";
import { TargetGuardError, assertLocalComposeTarget, loadDotenv } from "./lib/local-target.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const terminate = args.includes("--terminate-connections");
const confirmArg = args.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);

const refuse = (message: string): never => {
  console.error(`✖ Refusing to recreate the database: ${message}`);
  process.exit(1);
};

// 1. Target checks (no connection yet). Shell values win over .env, as with --env-file; the guard refuses conflicts.
const dotenv = loadDotenv();
const env = { ...dotenv, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) };
let config;
try {
  config = assertLocalComposeTarget(env, { dotenv, requireAppEnv: true });
} catch (err) {
  if (err instanceof TargetGuardError) refuse(err.message);
  throw err;
}
const appEnv = env.APP_ENV?.trim();
const target = config.database;
if (appEnv === "development" && target !== "vshow") {
  refuse(`the development database must be named 'vshow' (found '${target}').`);
}
if (!/^[a-z][a-z0-9_]*$/.test(target) || ["postgres", "template0", "template1"].includes(target)) {
  refuse("the target database name is not acceptable.");
}
const user = decodeURIComponent(new URL(config.url).username);
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(user)) refuse("the database user name is not acceptable.");

// 2. Typed confirmation (before any connection).
let answer = confirmArg;
if (answer === undefined) {
  if (!process.stdin.isTTY) refuse("non-interactive shell; pass --confirm=<database name>.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  answer = await rl.question(
    `This DELETES database '${target}' on ${config.host}:${config.port} and creates it empty.\n` +
      `Other databases and the server itself are not touched.\nType the database name to confirm: `,
  );
  rl.close();
}
if (answer !== target) refuse("confirmation did not match; nothing changed.");

// 3. Connect to the maintenance database, never to the target.
const adminUrl = new URL(config.url);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({
  connectionString: adminUrl.toString(),
  connectionTimeoutMillis: 8_000,
  query_timeout: 30_000,
});
try {
  await admin.connect();
} catch (err) {
  refuse(`could not connect to ${config.host}:${config.port}: ${describeError(err, config.url)}`);
}

const q = (sql: string, params: unknown[] = []) => admin.query(sql, params);
const list = async () =>
  (await q("select datname from pg_database where not datistemplate order by 1")).rows.map((r) => r.datname as string);

let exitCode = 0;
try {
  const before = await list();
  const bystanders = before.filter((d) => d !== target);
  const existing = (
    await q(
      `select pg_get_userbyid(datdba) as owner, pg_encoding_to_char(encoding) as encoding, datcollate, datctype
         from pg_database where datname = $1`,
      [target],
    )
  ).rows[0] as { owner: string; encoding: string; datcollate: string; datctype: string } | undefined;
  const sessions = existing
    ? Number(
        (
          await q("select count(*)::int as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [
            target,
          ])
        ).rows[0].n,
      )
    : 0;

  console.log(`Target: ${config.host}:${config.port}/${target} (${existing ? "exists" : "does not exist yet"})`);
  console.log(`Other databases that will not be touched: ${bystanders.length ? bystanders.join(", ") : "(none)"}`);
  if (sessions > 0) console.log(`Other sessions connected to '${target}': ${sessions}`);

  if (sessions > 0 && !terminate) {
    refuse(
      `${sessions} other session(s) are connected to '${target}'. Stop the dev server (npm run dev) and any SQL client, ` +
        `or re-run with --terminate-connections to disconnect them.`,
    );
  }
  if (dryRun) {
    console.log("Dry run: every check passed. Nothing was changed.");
  } else {
    if (existing) {
      // WITH (FORCE) disconnects sessions; it is used only when sessions exist AND the operator asked for it.
      await q(`drop database "${target}"${sessions > 0 ? " with (force)" : ""}`);
    }
    const o = existing?.owner ?? user;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(o)) throw new Error("the existing database owner has an unexpected name");
    const options = existing
      ? ` encoding ${admin.escapeLiteral(existing.encoding)} lc_collate ${admin.escapeLiteral(existing.datcollate)} lc_ctype ${admin.escapeLiteral(existing.datctype)} template template0`
      : "";
    await q(`create database "${target}" owner "${o}"${options}`);
    // Only statements naming the target were issued. Other databases may legitimately appear or vanish at the same
    // time (for example disposable test databases), so only the target itself is verified.
    if (!(await list()).includes(target)) throw new Error("post-check failed: the database was not recreated");
    console.log(
      `✔ Database '${target}' was dropped and recreated empty. ${bystanders.length} other database(s) were not touched.`,
    );
    console.log("  No migrations or seeds were run. Next: npm run db:migrate   (then optionally: npm run db:seed)");
  }
} catch (err) {
  exitCode = 1;
  console.error(`✖ Failed: ${redact(describeError(err, config.url), config.url)}`);
} finally {
  await admin.end().catch(() => {});
}
process.exit(exitCode);
