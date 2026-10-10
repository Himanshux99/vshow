import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DbConfigError, redact, resolveDbConfig } from "../app/db/config.server.ts";

const LOCAL = "postgresql://vshow:s3cretpw@127.0.0.1:5432/vshow";
const NEON_DIRECT = "postgresql://u:s3cretpw@ep-cool-1234.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const NEON_POOLED = "postgresql://u:s3cretpw@ep-cool-1234-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";

const throwsConfig = (fn: () => unknown, pattern: RegExp) => {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof DbConfigError);
    assert.match(err.message, pattern);
    assert.ok(!err.message.includes("s3cretpw"), "error message must not contain the password");
    return true;
  });
};

describe("resolveDbConfig", () => {
  it("accepts a local URL", () => {
    const c = resolveDbConfig({ DB_TARGET: "local", DATABASE_URL: LOCAL }, "migration");
    assert.deepEqual([c.host, c.port, c.database, c.isLocal], ["127.0.0.1", "5432", "vshow", true]);
  });

  it("requires DATABASE_URL", () => {
    throwsConfig(() => resolveDbConfig({ DB_TARGET: "local" }, "runtime"), /DATABASE_URL is not set/);
  });

  it("rejects malformed and non-postgres URLs without echoing them", () => {
    throwsConfig(() => resolveDbConfig({ DATABASE_URL: "not a url s3cretpw" }, "runtime"), /not a valid URL/);
    throwsConfig(() => resolveDbConfig({ DATABASE_URL: "mysql://u:s3cretpw@h/db" }, "runtime"), /must start with postgresql/);
    throwsConfig(() => resolveDbConfig({ DATABASE_URL: "postgresql://u:s3cretpw@127.0.0.1:5432/" }, "runtime"), /no database name/);
  });

  it("rejects an invalid DB_TARGET", () => {
    throwsConfig(() => resolveDbConfig({ DB_TARGET: "prod", DATABASE_URL: LOCAL }, "runtime"), /DB_TARGET must be/);
  });

  it("requires an explicit DB_TARGET for migrations but not for runtime", () => {
    throwsConfig(() => resolveDbConfig({ DATABASE_URL: LOCAL }, "migration"), /DB_TARGET is not set/);
    assert.equal(resolveDbConfig({ DATABASE_URL: LOCAL }, "runtime").target, undefined);
  });

  it("refuses target/host mismatches", () => {
    throwsConfig(() => resolveDbConfig({ DB_TARGET: "local", DATABASE_URL: NEON_DIRECT }, "runtime"), /not a loopback host/);
    throwsConfig(() => resolveDbConfig({ DB_TARGET: "neon", DATABASE_URL: LOCAL }, "runtime"), /not a \*\.neon\.tech host/);
    throwsConfig(
      () => resolveDbConfig({ DB_TARGET: "neon", DATABASE_URL: "postgresql://u:s3cretpw@db.example.com/x?sslmode=require" }, "runtime"),
      /not a \*\.neon\.tech host/,
    );
  });

  it("requires TLS for Neon", () => {
    throwsConfig(
      () => resolveDbConfig({ DB_TARGET: "neon", DATABASE_URL: NEON_DIRECT.replace("?sslmode=require", "") }, "runtime"),
      /sslmode=require/,
    );
  });

  it("allows the pooled URL at runtime but never for migrations", () => {
    assert.equal(resolveDbConfig({ DB_TARGET: "neon", DATABASE_URL: NEON_POOLED }, "runtime").isPooler, true);
    throwsConfig(() => resolveDbConfig({ DB_TARGET: "neon", DATABASE_URL: NEON_POOLED }, "migration"), /direct \(non-pooled\)/);
  });

  it("uses DATABASE_URL_DIRECT for migrations only", () => {
    const env = { DB_TARGET: "neon", DATABASE_URL: NEON_POOLED, DATABASE_URL_DIRECT: NEON_DIRECT };
    assert.equal(resolveDbConfig(env, "migration").isPooler, false);
    assert.equal(resolveDbConfig(env, "runtime").isPooler, true);
  });
});

describe("redact", () => {
  it("removes URLs and passwords from text", () => {
    const out = redact(`connect failed for ${LOCAL}; password s3cretpw rejected`, LOCAL);
    assert.ok(!out.includes("s3cretpw") && !out.includes("127.0.0.1:5432/vshow"));
    assert.ok(!redact("see postgres://a:b@host/db now").includes("a:b@"));
  });
});
