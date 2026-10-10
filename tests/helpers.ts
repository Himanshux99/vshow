import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { isLocalHost, resolveDbConfig } from "../app/db/config.server.ts";

/**
 * Runs a node script with the real environment plus test defaults: APP_ENV=test (so throwaway
 * `vshow_test_*` databases are permitted) and VSHOW_ENV_FILE='' (ignore the developer's .env when the
 * guard looks for shell-vs-.env conflicts). Individual tests override these to exercise refusals.
 */
export function runNode(args: string[], env?: Record<string, string>) {
  return spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", ...args], {
    encoding: "utf8",
    env: { ...process.env, APP_ENV: "test", VSHOW_ENV_FILE: "", ...env },
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
