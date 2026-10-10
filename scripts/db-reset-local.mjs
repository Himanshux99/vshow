#!/usr/bin/env node
// Destroys the LOCAL Docker Postgres volume and recreates an empty database.
// Refuses anything that is not provably the local compose database.
// Usage: npm run db:reset:local   (non-interactive: -- --confirm=<database name>)
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { LOCAL_HOSTS, describeUrl, parseEnv, readEnvFile } from "./lib/env.mjs";

const refuse = (m) => {
  console.error(`✖ Refusing to reset: ${m}`);
  process.exit(1);
};

const text = readEnvFile();
if (text === null) refuse("no .env file. Run `npm run setup` first.");
const env = parseEnv(text);

if (env.DB_TARGET !== "local") refuse(`DB_TARGET is '${env.DB_TARGET ?? "unset"}', not 'local'.`);
if (process.env.NODE_ENV === "production") refuse("NODE_ENV=production.");
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== env.DATABASE_URL) {
  refuse("DATABASE_URL in your shell differs from .env; unset it to avoid ambiguity.");
}
const d = describeUrl(env.DATABASE_URL ?? "");
if (!d) refuse("DATABASE_URL is missing or unparsable.");
if (!LOCAL_HOSTS.has(d.host)) refuse(`database host '${d.host}' is not local.`);
if (d.port !== String(env.POSTGRES_PORT || 5432)) refuse("DATABASE_URL port does not match POSTGRES_PORT (not the compose database).");
if (d.db !== (env.POSTGRES_DB || "vshow")) refuse("DATABASE_URL database does not match POSTGRES_DB.");

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
