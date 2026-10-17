import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RouterContextProvider } from "react-router";
import type { Db, DbProvider } from "../app/db/client.server.ts";
import type { AppDeps } from "../app/server/container.server.ts";
import {
  createRequestInstrumentation,
  isDataRequest,
  logUnscopedRequest,
} from "../app/server/instrumentation.server.ts";
import { appContext } from "../app/server/request-scope.server.ts";
import { captureLogs, noAuth, noStorage, testMedia } from "./helpers.ts";

const SECRET = "s3cr3t-value-123";

function setup() {
  const log = captureLogs();
  const database: DbProvider = { get: () => ({}) as Db, close: async () => {} };
  const deps: AppDeps = { logger: log.logger, database, auth: noAuth, storage: noStorage, media: testMedia };
  // Capture the `request` instrumentation React Router would call around every request.
  let around!: (
    handleRequest: () => Promise<unknown>,
    info: { request: Request; context?: RouterContextProvider },
  ) => Promise<void>;
  const instrumentation = createRequestInstrumentation(
    () => deps,
    (() => {
      let t = 0;
      return () => (t += 5);
    })(),
  );
  instrumentation.handler?.({
    instrument: (impl: { request: typeof around }) => {
      around = impl.request;
    },
  } as never);
  return { log, deps, run: around };
}

const ok = (statusCode: number) => async () => ({ status: "success", statusCode });

describe("request instrumentation: ownership of unscoped requests", () => {
  it("does nothing for requests the middleware already handled (no duplicate log line)", async () => {
    const { log, deps, run } = setup();
    const context = new RouterContextProvider();
    context.set(appContext, { ...deps, requestId: "r-scoped-0001" });
    await run(ok(200), { request: new Request("https://app.test/"), context });
    assert.equal(log.lines.length, 0);
  });

  it("logs an unmatched .data request once, with path only and a request ID", async () => {
    const { log, run } = setup();
    await run(ok(404), {
      request: new Request(`https://app.test/nope.data?token=${SECRET}`, {
        headers: { "x-request-id": "client-trace-id-01" },
      }),
      context: new RouterContextProvider(),
    });
    const [r] = log.records();
    assert.equal(log.lines.length, 1);
    assert.deepEqual(
      [r.requestId, r.method, r.path, r.status, r.matched, r.level],
      ["client-trace-id-01", "GET", "/nope.data", 404, false, "info"],
    );
    assert.equal(r.durationMs, 5);
    assert.ok(!log.text().includes(SECRET));
  });

  it("generates an ID when none (or an unsafe one) is supplied", async () => {
    const { log, run } = setup();
    await run(ok(404), { request: new Request("https://app.test/x.data"), context: new RouterContextProvider() });
    assert.match(String(log.records()[0].requestId), /^[0-9a-f-]{36}$/);
  });

  it("leaves unmatched DOCUMENT requests to entry.server (it can also set the header), so nothing is logged here", async () => {
    const { log, run } = setup();
    await run(ok(404), { request: new Request("https://app.test/nope"), context: new RouterContextProvider() });
    assert.equal(log.lines.length, 0);
  });

  it("logs failures before routing at error level with the scrubbed error", async () => {
    const { log, run } = setup();
    await run(async () => ({ status: "error", error: new Error(`boom postgresql://u:${SECRET}@h/db`) }), {
      request: new Request("https://app.test/anything"),
      context: new RouterContextProvider(),
    });
    const [r] = log.records();
    assert.equal(r.level, "error");
    assert.equal(r.msg, "request failed before routing");
    assert.equal(r.err?.type, "Error");
    assert.ok(!log.text().includes(SECRET));
  });

  it("logs 5xx data responses at error level", async () => {
    const { log, run } = setup();
    await run(ok(503), { request: new Request("https://app.test/a.data"), context: new RouterContextProvider() });
    assert.equal(log.records()[0].level, "error");
  });
});

describe("logUnscopedRequest (used by entry.server for unmatched documents)", () => {
  it("logs method, path and status with the supplied request ID, and never the query string or headers", () => {
    const log = captureLogs();
    logUnscopedRequest(log.logger, {
      request: new Request(`https://app.test/nope?code=${SECRET}&state=abc`, {
        headers: { cookie: `sid=${SECRET}`, authorization: `Bearer ${SECRET}` },
      }),
      status: 404,
      requestId: "doc-request-id-01",
    });
    const [r] = log.records();
    assert.deepEqual(
      [r.requestId, r.method, r.path, r.status, r.matched],
      ["doc-request-id-01", "GET", "/nope", 404, false],
    );
    assert.ok(!log.text().includes(SECRET));
    assert.ok(!/state=abc/.test(log.text()));
  });

  it("recognises single-fetch data requests", () => {
    assert.equal(isDataRequest({ url: "https://app.test/a/b.data?x=1" }), true);
    assert.equal(isDataRequest({ url: "https://app.test/a/b" }), false);
  });
});
