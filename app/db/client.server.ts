// Application database access (runtime only). Migrations live in scripts/db-migrate.ts and are
// never run from here. Server-only: the `.server` suffix keeps this out of client bundles.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolveDbConfig, redact } from "./config.server";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

function createDb() {
  const config = resolveDbConfig(process.env, "runtime");
  // Serverless-friendly sizing: each function instance keeps a few short-lived connections.
  // On Neon, DATABASE_URL should be the pooled (-pooler) connection string.
  const pool = new Pool({
    connectionString: config.url,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => {
    console.error(`[db] idle client error: ${redact(err.message, config.url)}`);
  });
  return drizzle({ client: pool, schema });
}

// Cached on globalThis so dev HMR and warm serverless invocations reuse one pool.
const globalForDb = globalThis as unknown as { __vshowDb?: Db };

/** Lazily creates the pool on first use so importing this module never connects. */
export function getDb(): Db {
  return (globalForDb.__vshowDb ??= createDb());
}
