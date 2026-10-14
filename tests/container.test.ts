import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { DbConfigError, resolveDbConfig, type DbConfig } from "../app/db/config.server.ts";
import { createDbProvider, type Db, type DbProvider, type PoolLike } from "../app/db/client.server.ts";
import { createContainer, getContainer, type AppDeps } from "../app/server/container.server.ts";
import { createNoopLogger } from "../app/logging/logger.server.ts";
import { captureLogs, noAuth } from "./helpers.ts";

const SECRET = "s3cr3t-value-123";
const LOCAL_URL = `postgresql://vshow:${SECRET}@127.0.0.1:55432/vshow`;
const config = (): DbConfig => resolveDbConfig({ DATABASE_URL: LOCAL_URL }, "runtime");

class FakePool extends EventEmitter implements PoolLike {
  ended = 0;
  async end() {
    this.ended++;
  }
}

describe("database provider (no real database)", () => {
  it("is lazy: building the provider resolves no config and creates no pool", () => {
    let resolved = 0;
    let created = 0;
    createDbProvider({
      logger: createNoopLogger(),
      resolveConfig: () => {
        resolved++;
        return config();
      },
      createPool: () => {
        created++;
        return new FakePool();
      },
    });
    assert.deepEqual([resolved, created], [0, 0]);
  });

  it("creates exactly one pool on first use and returns the same database afterwards", () => {
    let created = 0;
    const provider = createDbProvider({
      logger: createNoopLogger(),
      resolveConfig: config,
      createPool: () => {
        created++;
        return new FakePool();
      },
    });
    const first = provider.get();
    assert.equal(provider.get(), first);
    assert.equal(created, 1);
  });

  it("close() ends the pool once, is repeatable, and a later get() starts a fresh pool", async () => {
    const pools: FakePool[] = [];
    const provider = createDbProvider({
      logger: createNoopLogger(),
      resolveConfig: config,
      createPool: () => pools[pools.push(new FakePool()) - 1],
    });
    await provider.close(); // nothing created yet: no-op
    provider.get();
    await provider.close();
    await provider.close();
    assert.equal(pools[0].ended, 1);
    provider.get();
    assert.equal(pools.length, 2);
  });

  it("surfaces configuration errors lazily, without secrets, and retries on the next call", () => {
    let attempts = 0;
    const provider = createDbProvider({
      logger: createNoopLogger(),
      resolveConfig: () => {
        attempts++;
        return resolveDbConfig({ DATABASE_URL: attempts === 1 ? `mysql://u:${SECRET}@h/db` : LOCAL_URL }, "runtime");
      },
      createPool: () => new FakePool(),
    });
    assert.throws(
      () => provider.get(),
      (e: unknown) => e instanceof DbConfigError && !e.message.includes(SECRET),
    );
    assert.ok(provider.get(), "a corrected configuration works without restarting");
  });

  it("logs pool errors through the logger with credentials scrubbed", () => {
    const log = captureLogs();
    const pool = new FakePool();
    createDbProvider({ logger: log.logger, resolveConfig: config, createPool: () => pool }).get();
    pool.emit("error", new Error(`terminating connection to postgresql://vshow:${SECRET}@127.0.0.1:55432/vshow`));
    const errors = log.records().filter((r) => r.level === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].msg, "database idle client error");
    assert.ok(!log.text().includes(SECRET));
  });

  it("calls onPoolCreated exactly once, with the pool, when the pool is first created", () => {
    const seen: PoolLike[] = [];
    const pool = new FakePool();
    const provider = createDbProvider({
      logger: createNoopLogger(),
      resolveConfig: config,
      createPool: () => pool,
      onPoolCreated: (p) => seen.push(p),
    });
    assert.equal(seen.length, 0, "not called before first use");
    provider.get();
    provider.get();
    assert.deepEqual(seen, [pool]);
  });

  it("logs only host, port and database when a pool is created", () => {
    const log = captureLogs();
    createDbProvider({ logger: log.logger, resolveConfig: config, createPool: () => new FakePool() }).get();
    const [r] = log.records();
    assert.deepEqual([r.host, r.port, r.database], ["127.0.0.1", "55432", "vshow"]);
    assert.ok(!log.text().includes(SECRET));
  });
});

describe("dependency injection: business code with fake dependencies", () => {
  // A stand-in for future application code: it receives its dependencies explicitly.
  async function countThings(deps: AppDeps): Promise<number> {
    const db = deps.database.get() as unknown as { count(): Promise<number> };
    const n = await db.count();
    deps.logger.info("counted", { n });
    return n;
  }

  it("runs against an injected fake database and logger, touching no real infrastructure", async () => {
    const log = captureLogs();
    let gets = 0;
    const fake: DbProvider = {
      get: () => {
        gets++;
        return { count: async () => 42 } as unknown as Db;
      },
      close: async () => {},
    };
    const deps: AppDeps = { logger: log.logger, database: fake, auth: noAuth };
    assert.equal(gets, 0, "constructing dependencies does not use the database");
    assert.equal(await countThings(deps), 42);
    assert.equal(gets, 1);
    assert.equal(log.records()[0].n, 42);
  });

  it("lets a test make the database fail without any server", async () => {
    const deps: AppDeps = {
      logger: createNoopLogger(),
      auth: noAuth,
      database: {
        get: () => {
          throw new Error("simulated outage");
        },
        close: async () => {},
      },
    };
    await assert.rejects(countThings(deps), /simulated outage/);
  });
});

describe("composition root", () => {
  const quiet = { LOG_LEVEL: "silent" };

  it("builds real dependencies without opening a connection or requiring DATABASE_URL", () => {
    const deps = createContainer(quiet, false);
    assert.equal(typeof deps.logger.info, "function");
    assert.equal(typeof deps.database.get, "function");
  });

  it("fails only when the database is first used, and the error never contains the connection string", () => {
    const deps = createContainer({ ...quiet, DB_TARGET: "local", DATABASE_URL: `mysql://u:${SECRET}@h/db` }, false);
    assert.throws(
      () => deps.database.get(),
      (e: unknown) => e instanceof DbConfigError && !e.message.includes(SECRET),
    );
  });

  it("getContainer() returns one shared instance per process", () => {
    assert.equal(getContainer(), getContainer());
  });
});
