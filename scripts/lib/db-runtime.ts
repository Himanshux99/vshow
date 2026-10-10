// Shared helpers for the db CLI scripts (migrate / health). Run with Node's built-in TypeScript support.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { redact, type DbConfig } from "../../app/db/config.server.ts";

export const MIGRATIONS_DIR = "drizzle";

export function fail(message: string, code = 1): never {
  console.error(`✖ ${message}`);
  process.exit(code);
}

export async function connect(config: DbConfig): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: config.url,
    connectionTimeoutMillis: 8_000,
    query_timeout: 30_000,
  });
  try {
    await client.connect();
  } catch (err) {
    fail(`Could not connect to ${config.host}:${config.port}/${config.database}: ${describeError(err, config.url)}`);
  }
  return client;
}

export function describeError(err: unknown, url?: string): string {
  const e = err as { code?: string; message?: string };
  const msg = redact(e?.message || String(err), url);
  return e?.code ? `${e.code} ${msg}` : msg;
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export interface LocalMigration {
  tag: string;
  when: number;
  hash: string;
  sql: string;
}

/** Reads committed migrations the same way drizzle's migrator identifies them (sha256 of the SQL file). */
export function readLocalMigrations(dir = MIGRATIONS_DIR): LocalMigration[] {
  let journal: { entries: JournalEntry[] };
  try {
    journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));
  } catch {
    return [];
  }
  return journal.entries.map((e) => {
    const sql = readFileSync(join(dir, `${e.tag}.sql`), "utf8");
    return { tag: e.tag, when: e.when, sql, hash: createHash("sha256").update(sql).digest("hex") };
  });
}

export interface MigrationState {
  tableExists: boolean;
  applied: number;
  pending: LocalMigration[];
  /** Applied migrations whose hash no longer matches any committed file. */
  unknownApplied: string[];
}

export async function readMigrationState(client: pg.Client, local: LocalMigration[]): Promise<MigrationState> {
  const exists = await client.query("select to_regclass('drizzle.__drizzle_migrations') as t");
  if (!exists.rows[0].t) {
    return { tableExists: false, applied: 0, pending: local, unknownApplied: [] };
  }
  const res = await client.query("select hash, created_at from drizzle.__drizzle_migrations order by created_at");
  const known = new Set(local.map((m) => m.hash));
  const unknownApplied = res.rows.map((r) => r.hash as string).filter((h) => !known.has(h));
  // Same rule drizzle uses: anything newer than the latest applied migration is pending.
  const last = res.rows.length ? Math.max(...res.rows.map((r) => Number(r.created_at))) : -1;
  return {
    tableExists: true,
    applied: res.rows.length,
    pending: local.filter((m) => m.when > last),
    unknownApplied,
  };
}
