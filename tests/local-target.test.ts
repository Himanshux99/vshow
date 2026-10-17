import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TargetGuardError, assertLocalComposeTarget, loadDotenv } from "../scripts/lib/local-target.ts";
import { runNode } from "./helpers.ts";

const base = {
  APP_ENV: "development",
  DB_TARGET: "local",
  DATABASE_URL: "postgresql://vshow:s3cretpw@127.0.0.1:55432/vshow",
  POSTGRES_PORT: "55432",
  POSTGRES_DB: "vshow",
  POSTGRES_USER: "vshow",
};
type Env = Record<string, string | undefined>;
const url = (host: string, port: string | number, db: string, user = "vshow") =>
  `postgresql://${user}:s3cretpw@${host}:${port}/${db}`;

const refused = (env: Env, pattern: RegExp, dotenv?: Record<string, string>) =>
  assert.throws(
    () => assertLocalComposeTarget(env, { dotenv }),
    (e: unknown) => {
      assert.ok(e instanceof TargetGuardError, `expected TargetGuardError, got ${e}`);
      assert.match(e.message, pattern);
      assert.ok(!e.message.includes("s3cretpw"), "message must not leak the password");
      return true;
    },
  );

describe("local target guard: accepted", () => {
  it("accepts the Compose database on the configured port", () => {
    const c = assertLocalComposeTarget(base);
    assert.deepEqual([c.host, c.port, c.database], ["127.0.0.1", "55432", "vshow"]);
  });

  it("accepts localhost and the default port/database when POSTGRES_* are unset", () => {
    assert.ok(assertLocalComposeTarget({ ...base, DATABASE_URL: url("localhost", 55432, "vshow") }));
    const defaults = { APP_ENV: "test", DB_TARGET: "local", DATABASE_URL: url("127.0.0.1", 5432, "vshow") };
    assert.equal(assertLocalComposeTarget(defaults).port, "5432");
  });

  it("allows throwaway vshow_test_* databases only under APP_ENV=test", () => {
    const db = url("127.0.0.1", 55432, "vshow_test_seed_ab12cd34");
    assert.ok(assertLocalComposeTarget({ ...base, APP_ENV: "test", DATABASE_URL: db }));
    refused({ ...base, DATABASE_URL: db }, /not the expected local database/);
  });

  it("accepts a matching DATABASE_URL_DIRECT and a .env that agrees with the environment", () => {
    const env = { ...base, DATABASE_URL_DIRECT: base.DATABASE_URL };
    assert.ok(assertLocalComposeTarget(env, { dotenv: { ...base } }));
  });
});

describe("local target guard: loopback is not enough", () => {
  it("rejects a loopback URL with the wrong port (possible tunnel)", () => {
    refused({ ...base, DATABASE_URL: url("127.0.0.1", 6543, "vshow") }, /Port 6543 does not match/);
    refused({ ...base, DATABASE_URL: url("127.0.0.1", 5432, "vshow") }, /does not match the local Compose port 55432/);
  });

  it("rejects an unexpected database name or user", () => {
    refused({ ...base, DATABASE_URL: url("127.0.0.1", 55432, "campus_live") }, /not the expected local database/);
    refused({ ...base, DATABASE_URL: url("127.0.0.1", 55432, "vshow_test_x") }, /not the expected local database/);
    refused({ ...base, DATABASE_URL: url("127.0.0.1", 55432, "vshow", "admin") }, /user does not match/);
  });

  it("rejects production-like names even if POSTGRES_DB is changed to match", () => {
    const env = { ...base, POSTGRES_DB: "vshow_prod", DATABASE_URL: url("127.0.0.1", 55432, "vshow_prod") };
    refused(env, /non-development database/);
  });

  it("rejects non-approved and remote hosts", () => {
    for (const host of ["0.0.0.0", "192.168.1.20", "db.example.com", "[::1]", "ep-x-1.eu.aws.neon.tech"]) {
      refused({ ...base, DATABASE_URL: url(host, 55432, "vshow") }, /(not an approved local host|not a loopback)/);
    }
  });

  it("rejects an invalid POSTGRES_PORT", () => {
    refused({ ...base, POSTGRES_PORT: "abc" }, /not a valid port/);
  });
});

describe("local target guard: unknown, production and conflicting configuration", () => {
  it("fails closed on missing, remote or unknown DB_TARGET", () => {
    refused({ ...base, DB_TARGET: undefined }, /DB_TARGET is 'unset'/);
    refused({ ...base, DB_TARGET: "neon" }, /not 'local'/);
    refused({ ...base, DB_TARGET: "prod" }, /not 'local'/);
    refused({ ...base, DATABASE_URL: undefined }, /DATABASE_URL is not set/);
  });

  it("rejects production-like environments", () => {
    for (const v of ["production", "preview", "staging", "Development"])
      refused({ ...base, APP_ENV: v }, /not allowed/);
    refused({ ...base, NODE_ENV: "production" }, /NODE_ENV=production/);
    refused({ ...base, VERCEL: "1" }, /Vercel/);
    refused({ ...base, VERCEL_ENV: "preview" }, /Vercel/);
  });

  it("requires APP_ENV only when asked to", () => {
    assert.ok(assertLocalComposeTarget({ ...base, APP_ENV: undefined }));
    assert.throws(
      () => assertLocalComposeTarget({ ...base, APP_ENV: undefined }, { requireAppEnv: true }),
      /APP_ENV is not set/,
    );
  });

  it("rejects conflicting DATABASE_URL and DATABASE_URL_DIRECT", () => {
    for (const other of [
      url("127.0.0.1", 6543, "vshow"),
      url("127.0.0.1", 55432, "other"),
      url("localhost", 55432, "vshow"),
    ]) {
      refused({ ...base, DATABASE_URL_DIRECT: other }, /different databases|Port 6543|not the expected/);
    }
    refused(
      { ...base, DATABASE_URL_DIRECT: "postgresql://u:s3cretpw@ep-x-1.eu.aws.neon.tech/n?sslmode=require" },
      /not an approved local host|not a loopback/,
    );
  });

  it("rejects shell values that silently override a different .env value", () => {
    const dotenv = { ...base };
    refused({ ...base, DATABASE_URL: url("127.0.0.1", 6543, "vshow") }, /DATABASE_URL in your shell differs/, dotenv);
    refused(
      { ...base, POSTGRES_PORT: "5432", DATABASE_URL: url("127.0.0.1", 5432, "vshow") },
      /differs from \.env/,
      dotenv,
    );
    refused({ ...base, DB_TARGET: "neon" }, /not 'local'/, dotenv);
  });
});

describe("loadDotenv", () => {
  it("returns nothing for an empty or missing path, and parses an existing file", () => {
    assert.deepEqual(loadDotenv(""), {});
    assert.deepEqual(loadDotenv(join(tmpdir(), "vshow-does-not-exist.env")), {});
    const dir = mkdtempSync(join(tmpdir(), "vshow-env-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(file, "# c\nA=1\nB='two'\n");
      assert.deepEqual(loadDotenv(file), { A: "1", B: "two" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The same guard must stop the real commands before they ever try to connect.
describe("commands refuse mismatched local targets before connecting", () => {
  const tunnel = {
    DB_TARGET: "local",
    DATABASE_URL: url("127.0.0.1", 6543, "vshow"),
    DATABASE_URL_DIRECT: "",
    POSTGRES_PORT: "55432",
    POSTGRES_DB: "vshow",
    POSTGRES_USER: "vshow",
  };

  it("db:migrate", () => {
    const r = runNode(["scripts/db-migrate.ts", "--dry-run"], tunnel);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Migration refused: Port 6543 does not match/);
    assert.ok(!(r.stdout + r.stderr).includes("s3cretpw"));
  });

  it("db:seed", () => {
    const r = runNode(["scripts/db-seed.ts"], tunnel);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Seeding refused: Port 6543 does not match/);
  });

  it("db:migrate on a wrong database name", () => {
    const r = runNode(["scripts/db-migrate.ts", "--dry-run"], {
      ...tunnel,
      DATABASE_URL: url("127.0.0.1", 55432, "campus_live"),
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not the expected local database/);
  });

  it("db:migrate keeps requiring --confirm-host for a Neon target", () => {
    const neon = "postgresql://u:s3cretpw@ep-x-1.eu.aws.neon.tech/neondb?sslmode=require";
    const r = runNode(["scripts/db-migrate.ts"], { DB_TARGET: "neon", DATABASE_URL: neon, DATABASE_URL_DIRECT: "" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /explicit authorization/);
  });

  it("db:reset:local refuses a mismatched target and never resets", () => {
    // The confirmation can never match, so even a guard regression cannot reach docker compose.
    const r = runNode(["scripts/db-reset-local.mjs", "--confirm=__never_matches__"], tunnel);
    assert.equal(r.status, 1);
    // Either no .env exists (CI) or the guard itself rejects the mismatch.
    assert.match(r.stderr, /Refusing to reset: (Port 6543 does not match|no \.env file)/);
  });
});
