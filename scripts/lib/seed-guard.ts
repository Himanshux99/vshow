// Fail-closed safety checks for development seeding. Pure (no I/O) so it is unit-testable.
import { DbConfigError, isLocalHost, resolveDbConfig, type DbConfig } from "../../app/db/config.server.ts";

export class SeedGuardError extends Error {
  override name = "SeedGuardError";
}

const ALLOWED_APP_ENVS = new Set(["development", "test"]);

/**
 * Returns the validated local database config, or throws SeedGuardError.
 * Seeding is allowed only when ALL of these hold:
 *  - APP_ENV is explicitly "development" or "test" (unset/unknown/preview/production => refused)
 *  - no production/Vercel runtime markers are present
 *  - DB_TARGET=local and every configured database URL is a loopback host
 *  - the database name does not look like production
 * There is deliberately no opt-in for remote databases.
 */
export function assertSeedAllowed(env: Record<string, string | undefined>): DbConfig {
  const appEnv = env.APP_ENV?.trim();
  if (!appEnv) {
    throw new SeedGuardError("APP_ENV is not set. Seeding requires APP_ENV=development or APP_ENV=test.");
  }
  if (!ALLOWED_APP_ENVS.has(appEnv)) {
    throw new SeedGuardError(`APP_ENV='${appEnv}' is not allowed. Seeding only runs with APP_ENV=development or test.`);
  }
  if (env.NODE_ENV === "production") {
    throw new SeedGuardError("NODE_ENV=production: seeding is refused.");
  }
  if (env.VERCEL || env.VERCEL_ENV) {
    throw new SeedGuardError("Vercel runtime detected: seeding is refused.");
  }

  let config: DbConfig;
  try {
    config = resolveDbConfig(env, "migration");
    if (env.DATABASE_URL?.trim()) {
      const runtime = resolveDbConfig(env, "runtime");
      if (!isLocalHost(runtime.host)) throw new SeedGuardError("DATABASE_URL is not a loopback host.");
    }
  } catch (err) {
    if (err instanceof DbConfigError) throw new SeedGuardError(err.message);
    throw err;
  }

  if (config.target !== "local" || !isLocalHost(config.host)) {
    throw new SeedGuardError(
      `Target '${config.target}' (${config.host}) is not the local database. Seeding remote databases is not supported.`,
    );
  }
  if (/prod/i.test(config.database)) {
    throw new SeedGuardError(`Database name '${config.database}' looks like production: seeding is refused.`);
  }
  return config;
}
