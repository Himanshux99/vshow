// Single source of truth for "is this database provably the local Docker Compose database?".
// Used by every command that writes to a local database (db:migrate on a local target, db:seed,
// db:reset:local). Fails closed: anything it cannot classify with confidence is refused.
//
// A loopback address alone is NOT enough: an SSH tunnel or port-forward to a remote database also
// looks like 127.0.0.1. So the host, port, database name and user must all match the local
// configuration declared in the environment (the same POSTGRES_* values docker-compose.yml uses).
import { existsSync, readFileSync } from "node:fs";
import { DbConfigError, resolveDbConfig, type DbConfig } from "../../app/db/config.server.ts";

export class TargetGuardError extends Error {
  override name = "TargetGuardError";
}

export interface GuardOptions {
  /** Seeding demands an explicit APP_ENV; other commands only reject a non-dev/test value if one is set. */
  requireAppEnv?: boolean;
  /** Values from the .env file, to detect shell variables that silently override it. */
  dotenv?: Record<string, string>;
}

const APPROVED_HOSTS = new Set(["127.0.0.1", "localhost"]);
const ALLOWED_APP_ENVS = new Set(["development", "test"]);
const PRODUCTION_LIKE = /prod|live|staging|preview/i;
/** Throwaway databases created by the automated tests (APP_ENV=test only). */
const TEST_DB_NAME = /^vshow_test(_[a-z0-9]+)*$/;
/** Variables that decide which database is used; a shell value must not silently differ from .env. */
const CONFLICT_KEYS = [
  "APP_ENV",
  "DB_TARGET",
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_USER",
];

type Env = Record<string, string | undefined>;

function parts(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    user: decodeURIComponent(u.username),
  };
}

/** Parses KEY=VALUE lines. Path defaults to VSHOW_ENV_FILE or .env; missing/empty path => no values. */
export function loadDotenv(path: string | undefined = process.env.VSHOW_ENV_FILE ?? ".env"): Record<string, string> {
  if (!path || !existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Returns the validated local config, or throws TargetGuardError. Never includes URLs/passwords in messages. */
export function assertLocalComposeTarget(env: Env, options: GuardOptions = {}): DbConfig {
  const appEnv = env.APP_ENV?.trim();
  if (options.requireAppEnv && !appEnv) {
    throw new TargetGuardError("APP_ENV is not set. This command requires APP_ENV=development or APP_ENV=test.");
  }
  if (appEnv && !ALLOWED_APP_ENVS.has(appEnv)) {
    throw new TargetGuardError(`APP_ENV='${appEnv}' is not allowed. Only development or test may use this command.`);
  }
  if (env.NODE_ENV === "production") throw new TargetGuardError("NODE_ENV=production: refused.");
  if (env.VERCEL || env.VERCEL_ENV) throw new TargetGuardError("Vercel runtime detected: refused.");

  if (env.DB_TARGET?.trim() !== "local") {
    throw new TargetGuardError(
      `DB_TARGET is '${env.DB_TARGET?.trim() || "unset"}', not 'local'. Remote databases are not supported by this command.`,
    );
  }

  // A shell variable that overrides a different value in .env is ambiguous: refuse rather than guess.
  for (const key of CONFLICT_KEYS) {
    const fromFile = options.dotenv?.[key];
    const fromEnv = env[key];
    if (fromFile && fromEnv !== undefined && fromEnv !== fromFile) {
      throw new TargetGuardError(
        `${key} in your shell differs from .env. Unset it or make them match; refusing to guess.`,
      );
    }
  }

  let config: DbConfig;
  try {
    config = resolveDbConfig(env, "migration");
  } catch (err) {
    if (err instanceof DbConfigError) throw new TargetGuardError(err.message);
    throw err;
  }

  // Every configured URL must describe the same database.
  const main = parts(config.url);
  for (const name of ["DATABASE_URL", "DATABASE_URL_DIRECT"] as const) {
    const value = env[name]?.trim();
    if (!value) continue;
    let other;
    try {
      other = parts(value);
    } catch {
      throw new TargetGuardError(`${name} is not a valid URL.`);
    }
    if (other.host !== main.host || other.port !== main.port || other.database !== main.database) {
      throw new TargetGuardError("DATABASE_URL and DATABASE_URL_DIRECT point at different databases: refusing.");
    }
  }

  if (!APPROVED_HOSTS.has(main.host)) {
    throw new TargetGuardError(`Host '${main.host}' is not an approved local host (127.0.0.1 or localhost).`);
  }

  const expectedPort = env.POSTGRES_PORT?.trim() || "5432";
  const expectedDb = env.POSTGRES_DB?.trim() || "vshow";
  const expectedUser = env.POSTGRES_USER?.trim() || "vshow";
  if (!/^\d{1,5}$/.test(expectedPort)) throw new TargetGuardError("POSTGRES_PORT is not a valid port number.");

  if (main.port !== expectedPort) {
    throw new TargetGuardError(
      `Port ${main.port} does not match the local Compose port ${expectedPort} (POSTGRES_PORT). It may be a tunnel to another database.`,
    );
  }
  if (main.user !== expectedUser) {
    throw new TargetGuardError("Database user does not match POSTGRES_USER for the local Compose database.");
  }
  const testDbAllowed = appEnv === "test" && TEST_DB_NAME.test(main.database);
  if (main.database !== expectedDb && !testDbAllowed) {
    throw new TargetGuardError(`Database name '${main.database}' is not the expected local database '${expectedDb}'.`);
  }
  if (PRODUCTION_LIKE.test(main.database)) {
    throw new TargetGuardError(`Database name '${main.database}' looks like a non-development database: refused.`);
  }
  return config;
}
