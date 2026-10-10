#!/usr/bin/env node
// Destroys the LOCAL Docker Postgres volume and recreates an empty database.
// Refuses anything that is not provably the local compose database (shared guard: lib/local-target.ts).
// Usage: npm run db:reset:local   (non-interactive: -- --confirm=<database name>)
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { readEnvFile } from "./lib/env.mjs";
import { TargetGuardError, assertLocalComposeTarget, loadDotenv } from "./lib/local-target.ts";

const refuse = (m) => {
  console.error(`✖ Refusing to reset: ${m}`);
  process.exit(1);
};

if (readEnvFile() === null) refuse("no .env file. Run `npm run setup` first.");
// Same precedence as --env-file: shell variables win, .env fills the gaps. The shared guard then
// refuses if a shell value conflicts with .env, or if the target is not the local Compose database.
const dotenv = loadDotenv();
const env = { ...dotenv, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) };
let config;
try {
  config = assertLocalComposeTarget(env, { dotenv });
} catch (err) {
  if (err instanceof TargetGuardError) refuse(err.message);
  throw err;
}
const d = { db: config.database, port: config.port };

let answer = process.argv.find((a) => a.startsWith("--confirm="))?.slice(10);
if (answer === undefined) {
  if (!process.stdin.isTTY) refuse("non-interactive shell; pass --confirm=<database name>.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  answer = await rl.question(
    `This DELETES all data in local database '${d.db}' (127.0.0.1:${d.port}).\nType the database name to confirm: `,
  );
  rl.close();
}
if (answer !== d.db) refuse("confirmation did not match; nothing changed.");

const compose = (...a) => {
  if (spawnSync("docker", ["compose", ...a], { stdio: "inherit" }).status !== 0) {
    console.error("✖ docker compose failed.");
    process.exit(1);
  }
};
compose("down", "--volumes");
compose("up", "-d", "--wait", "postgres");
console.log("✔ Local database reset to empty. No migrations or seeds were run.");
