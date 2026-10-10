#!/usr/bin/env node
// First-time / repeat-safe developer setup. Never prints secrets or full URLs.
// Usage: npm run setup [-- --db=local|neon] [-- --check]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  ENV_FILE,
  EXAMPLE_FILE,
  REQUIRED_NODE_MAJOR,
  pinnedNpmVersion,
  describeUrl,
  isPlaceholder,
  nodeVersionOk,
  parseEnv,
  readEnvFile,
  run,
  setEnvValue,
  writeEnvFile,
} from "./lib/env.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const dbFlag = args.find((a) => a.startsWith("--db="))?.slice(5);
const errors = [];
const notes = [];

if (dbFlag && !["local", "neon"].includes(dbFlag)) {
  console.error("✖ --db must be 'local' or 'neon'.");
  process.exit(1);
}
if (!existsSync(EXAMPLE_FILE)) {
  console.error(`✖ ${EXAMPLE_FILE} is missing. Run from the repository root.`);
  process.exit(1);
}

const existing = readEnvFile();
let text = existing ?? readFileSync(EXAMPLE_FILE, "utf8");
const env = () => parseEnv(text);
const target = dbFlag ?? (isPlaceholder(env().DB_TARGET) ? "local" : env().DB_TARGET);
if (!["local", "neon"].includes(target)) {
  errors.push(`DB_TARGET must be 'local' or 'neon' (found '${target}').`);
}
if (existing && dbFlag && env().DB_TARGET && env().DB_TARGET !== dbFlag) {
  errors.push(
    `${ENV_FILE} already has DB_TARGET=${env().DB_TARGET}; edit it manually to switch (setup never overrides your choice).`,
  );
}

// --- tool validation
if (!nodeVersionOk()) {
  errors.push(
    `Node ${process.versions.node} is not supported; this project requires Node ${REQUIRED_NODE_MAJOR}.x. Install via nvm/fnm (reads .nvmrc) or https://nodejs.org.`,
  );
}
const npmPinned = pinnedNpmVersion();
// Set by npm when launched via `npm run setup` (works on Windows, where spawning "npm" needs a shell).
const npmActual =
  process.env.npm_config_user_agent?.match(/^npm\/(\d+\.\d+\.\d+)/)?.[1] ?? run("npm", ["--version"]).stdout?.trim();
if (npmPinned && npmActual && npmActual !== npmPinned) {
  notes.push(
    `npm ${npmActual} differs from the pinned ${npmPinned} (package.json packageManager); run \`npm install -g npm@${npmPinned}\`.`,
  );
}
if (target === "local") {
  if (run("docker", ["compose", "version"]).status !== 0) {
    errors.push(
      "Docker Compose v2 not found. Install Docker Desktop (Windows/macOS) or Docker Engine + compose plugin (Linux), or use --db=neon.",
    );
  } else if (run("docker", ["info"]).status !== 0) {
    errors.push(
      "Docker is installed but the daemon is not running. Start Docker Desktop / the docker service and re-run.",
    );
  }
}
if (errors.length) {
  errors.forEach((e) => console.error(`✖ ${e}`));
  process.exit(1);
}

// --- environment: only fills missing/placeholder values; existing values are kept
const created = !existing;
const changed = [];
const fill = (key, make) => {
  if (isPlaceholder(env()[key])) {
    text = setEnvValue(text, key, make());
    changed.push(key);
  }
};
if (env().DB_TARGET !== target) {
  text = setEnvValue(text, "DB_TARGET", target);
  changed.push("DB_TARGET");
}
if (isPlaceholder(env().APP_ENV)) {
  text = setEnvValue(text, "APP_ENV", "development");
  changed.push("APP_ENV");
}
fill("BETTER_AUTH_SECRET", () => randomBytes(32).toString("base64"));
if (env().BETTER_AUTH_SECRET.length < 32) {
  notes.push("BETTER_AUTH_SECRET is shorter than 32 characters; replace it with a stronger value.");
}

if (target === "local") {
  fill("POSTGRES_PASSWORD", () => randomBytes(24).toString("hex"));
  // Only fill DATABASE_URL when empty; a user-supplied URL is never rewritten.
  fill("DATABASE_URL", () => {
    const e = env();
    const user = encodeURIComponent(e.POSTGRES_USER || "vshow");
    const pw = encodeURIComponent(e.POSTGRES_PASSWORD);
    return `postgresql://${user}:${pw}@127.0.0.1:${e.POSTGRES_PORT || 5432}/${e.POSTGRES_DB || "vshow"}`;
  });
  const d = describeUrl(env().DATABASE_URL);
  if (!d || !["127.0.0.1", "localhost"].includes(d.host)) {
    notes.push(
      "DB_TARGET=local but DATABASE_URL does not point at 127.0.0.1/localhost. Fix it before using the database.",
    );
  }
} else {
  const d = describeUrl(env().DATABASE_URL ?? "");
  if (isPlaceholder(env().DATABASE_URL)) {
    notes.push(`Action required: set DATABASE_URL in ${ENV_FILE} to your Neon connection string (never commit it).`);
  } else if (!d || !d.host.endsWith(".neon.tech")) {
    notes.push("DB_TARGET=neon but DATABASE_URL host is not *.neon.tech. Double-check it.");
  } else if (!/sslmode=require/.test(env().DATABASE_URL)) {
    notes.push("Neon URL should include ?sslmode=require.");
  }
}

if (check) {
  console.log(`✔ Tools OK (Node ${process.versions.node}, target=${target}).`);
  console.log(existing ? `✔ ${ENV_FILE} exists.` : `✖ ${ENV_FILE} missing — run \`npm run setup\`.`);
  if (changed.length) console.log(`✖ Missing/placeholder values: ${changed.join(", ")} — run \`npm run setup\`.`);
  notes.forEach((n) => console.log(`! ${n}`));
  process.exit(!existing || changed.length ? 1 : 0);
}

if (created || changed.length) writeEnvFile(text);
console.log(`✔ Node ${process.versions.node} OK; database target: ${target}`);
console.log(
  created ? `✔ Created ${ENV_FILE} from ${EXAMPLE_FILE}` : `✔ ${ENV_FILE} exists (existing values preserved)`,
);
console.log(changed.length ? `✔ Set: ${changed.join(", ")} (values not shown)` : "✔ Nothing to change");
notes.forEach((n) => console.log(`! ${n}`));
console.log(
  target === "local" ? "Next: npm install && npm run db:up && npm run dev" : "Next: npm install && npm run dev",
);
