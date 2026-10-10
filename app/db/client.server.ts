// Database access for the running application. Server-only (`.server`), and deliberately free of
// module-level state: nothing connects when this file is imported, and nothing here is global.
// Callers receive a `DbProvider` through the composition root (app/server/container.server.ts).
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Logger } from "../logging/logger.server.ts";
import type { DbConfig } from "./config.server.ts";
import * as schema from "./schema/index.ts";

export type Db = ReturnType<typeof createDrizzle>;

/** The minimal pool surface we use. Tests inject a fake instead of opening a real connection. */
export interface PoolLike {
  on(event: "error", listener: (err: Error) => void): unknown;
  end(): Promise<void>;
}

export interface DbProvider {
  /** Returns the database, creating the pool on first use. Throws if configuration is invalid. */
  get(): Db;
  /** Closes the pool if one was created. Safe to call repeatedly. */
  close(): Promise<void>;
}

export interface DbProviderOptions {
  /** Resolved lazily on first `get()`, so a missing/invalid DATABASE_URL never breaks unrelated pages. */
  resolveConfig: () => DbConfig;
  logger: Logger;
  /** Test seam: build the pool. Defaults to a small node-postgres pool. */
  createPool?: (config: DbConfig) => PoolLike;
}

function createDrizzle(pool: PoolLike) {
  // drizzle's typings want a real pg.Pool; PoolLike is the subset we depend on.
  return drizzle({ client: pool as unknown as Pool, schema });
}

function defaultCreatePool(config: DbConfig): PoolLike {
  // Serverless-friendly sizing: each instance keeps a few short-lived connections.
  // On Neon, DATABASE_URL should be the pooled (-pooler) connection string.
  return new Pool({
    connectionString: config.url,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createDbProvider(options: DbProviderOptions): DbProvider {
  const { resolveConfig, logger, createPool = defaultCreatePool } = options;
  let state: { db: Db; pool: PoolLike } | undefined;

  return {
    get() {
      if (state) return state.db;
      const config = resolveConfig();
      const pool = createPool(config);
      // Only host/port/database are logged; the connection string never is (and would be scrubbed anyway).
      logger.debug("database pool created", { host: config.host, port: config.port, database: config.database });
      pool.on("error", (err) => logger.error("database idle client error", { err }));
      state = { db: createDrizzle(pool), pool };
      return state.db;
    },
    async close() {
      const current = state;
      state = undefined;
      await current?.pool.end();
    },
  };
}
