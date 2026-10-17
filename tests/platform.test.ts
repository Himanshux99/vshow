import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { createDbProvider, type PoolLike } from "../app/db/client.server.ts";
import { resolveDbConfig } from "../app/db/config.server.ts";
import { createContainer } from "../app/server/container.server.ts";
import { detectPlatform, nodePlatform, selectPlatform } from "../app/platform/platform.server.ts";
import { createVercelAdapter } from "../app/platform/vercel.server.ts";
import { captureLogs } from "./helpers.ts";

class FakePool extends EventEmitter implements PoolLike {
  async end() {}
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("platform selection", () => {
  it("defaults to plain Node: no lifecycle hook", () => {
    assert.equal(detectPlatform({}), "node");
    const platform = selectPlatform({}, captureLogs().logger);
    assert.equal(platform, nodePlatform);
    assert.equal(platform.onPoolCreated, undefined);
  });

  it("selects the Vercel adapter only when VERCEL is set", () => {
    assert.equal(detectPlatform({ VERCEL: "1" }), "vercel");
    const platform = selectPlatform({ VERCEL: "1" }, captureLogs().logger);
    assert.equal(platform.name, "vercel");
    assert.equal(typeof platform.onPoolCreated, "function");
    assert.equal(detectPlatform({ VERCEL_ENV: "preview" }), "node", "only the VERCEL marker selects the adapter");
  });

  it("the container builds on any platform without touching the database", () => {
    for (const env of [{ LOG_LEVEL: "silent" }, { LOG_LEVEL: "silent", VERCEL: "1" }]) {
      const deps = createContainer(env, false);
      assert.equal(typeof deps.database.get, "function");
    }
  });
});

describe("Vercel adapter", () => {
  it("registers the pool with the vendor function when a pool is created", async () => {
    const attached: PoolLike[] = [];
    const adapter = createVercelAdapter(captureLogs().logger, {
      loadAttach: async () => (pool) => {
        attached.push(pool);
      },
    });
    const pool = new FakePool();
    adapter.onPoolCreated?.(pool);
    await settle();
    assert.deepEqual(attached, [pool]);
  });

  it("works end to end through the database provider, once per pool", async () => {
    const attached: PoolLike[] = [];
    const adapter = createVercelAdapter(captureLogs().logger, {
      loadAttach: async () => (p) => {
        attached.push(p);
      },
    });
    const provider = createDbProvider({
      logger: captureLogs().logger,
      resolveConfig: () => resolveDbConfig({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" }, "runtime"),
      createPool: () => new FakePool(),
      onPoolCreated: adapter.onPoolCreated?.bind(adapter),
    });
    provider.get();
    provider.get();
    await settle();
    assert.equal(attached.length, 1);
  });

  it("never lets a vendor failure break the app: it logs a warning instead", async () => {
    const log = captureLogs();
    const loadFails = createVercelAdapter(log.logger, {
      loadAttach: async () => {
        throw new Error("cannot load the vendor package");
      },
    });
    const attachFails = createVercelAdapter(log.logger, {
      loadAttach: async () => () => {
        throw new Error("attach exploded");
      },
    });
    loadFails.onPoolCreated?.(new FakePool());
    attachFails.onPoolCreated?.(new FakePool());
    await settle();
    const warnings = log.records().filter((r) => r.level === "warn");
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((w) => w.msg === "could not register the database pool with Vercel"));
  });
});
