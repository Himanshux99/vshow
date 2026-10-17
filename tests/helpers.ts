import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { isLocalHost, resolveDbConfig } from "../app/db/config.server.ts";
import type { AuthProvider } from "../app/auth/auth.server.ts";
import { createLogger, type LogLevel } from "../app/logging/logger.server.ts";
import { createUnconfiguredStorage } from "../app/storage/unconfigured.server.ts";
import { DEFAULT_MEDIA_POLICY } from "../app/submissions/media-policy.server.ts";

/**
 * Runs a node script with the real environment plus test defaults: APP_ENV=test (so throwaway
 * `vshow_test_*` databases are permitted) and VSHOW_ENV_FILE='' (ignore the developer's .env when the
 * guard looks for shell-vs-.env conflicts). VSHOW_DEV_AUTH is cleared because a developer's .env may enable it,
 * and dev auth refuses to start unless APP_ENV=development. Individual tests override these to exercise refusals.
 */
export function runNode(args: string[], env?: Record<string, string>) {
  return spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", ...args], {
    encoding: "utf8",
    env: { ...process.env, APP_ENV: "test", VSHOW_ENV_FILE: "", VSHOW_DEV_AUTH: "", ...env },
  });
}

export interface ThrowawayDb {
  url: string;
  skipReason: string;
  admin?: pg.Client;
  drop(): Promise<void>;
}

/** Creates a uniquely named database on the LOCAL server only; skipReason is set if unavailable. */
export async function createThrowawayDb(prefix: string): Promise<ThrowawayDb> {
  const name = `${prefix}_${randomBytes(4).toString("hex")}`;
  const result: ThrowawayDb = { url: "", skipReason: "", drop: async () => {} };
  try {
    const cfg = resolveDbConfig(process.env, "migration");
    if (cfg.target !== "local" || !isLocalHost(cfg.host)) throw new Error("DB_TARGET is not local");
    const adminUrl = new URL(cfg.url);
    adminUrl.pathname = "/postgres";
    const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 3000 });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const u = new URL(cfg.url);
    u.pathname = `/${name}`;
    result.url = u.toString();
    result.admin = admin;
    result.drop = async () => {
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    };
  } catch (err) {
    result.skipReason = `no local database available (${(err as Error).message.split("\n")[0].slice(0, 80)}); run npm run setup && npm run db:up`;
  }
  return result;
}

export type LogRecord = Record<string, unknown> & { err?: Record<string, unknown> };

/** A real Vshow logger (real Pino, real redaction) writing JSON lines into memory instead of stdout. */
export function captureLogs(level: LogLevel = "trace") {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    destination: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  });
  return {
    logger,
    lines,
    records: () => lines.map((l) => JSON.parse(l) as LogRecord),
    /** Everything that was written, as one string, for "this secret never appears anywhere" assertions. */
    text: () => lines.join(""),
  };
}

/** An auth provider for tests that never touch authentication. */
export const noAuth: AuthProvider = {
  devAuth: { enabled: false },
  config() {
    throw new Error("authentication is not configured in this test");
  },
  get() {
    throw new Error("authentication is not configured in this test");
  },
};

/** Storage for tests that never touch media: refuses every call, like the real unconfigured provider. */
export const noStorage = createUnconfiguredStorage();
export const testMedia = { ...DEFAULT_MEDIA_POLICY };
