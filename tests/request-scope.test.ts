import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RouterContextProvider } from "react-router";
import type { Db, DbProvider } from "../app/db/client.server.ts";
import type { AppDeps } from "../app/server/container.server.ts";
import {
  REQUEST_ID_HEADER,
  appContext,
  createRequestScopeMiddleware,
  getRequestScope,
  resolveRequestId,
} from "../app/server/request-scope.server.ts";
import { captureLogs, noAuth } from "./helpers.ts";

const SECRET = "s3cr3t-value-123";

/** Fake dependencies: a real logger writing to memory and a database that records whether it was touched. */
function makeDeps() {
  const log = captureLogs();
  let dbCalls = 0;
  const database: DbProvider = {
    get: () => {
      dbCalls++;
      return {} as Db;
    },
    close: async () => {},
  };
  const deps: AppDeps = { logger: log.logger, database, auth: noAuth };
  return { deps, log, dbCalls: () => dbCalls };
}

type MwArgs = Parameters<ReturnType<typeof createRequestScopeMiddleware>>[0];

async function run(
  mw: ReturnType<typeof createRequestScopeMiddleware>,
  request: Request,
  next: () => Promise<Response>,
  context = new RouterContextProvider(),
) {
  const result = await mw({ request, params: {}, context } as unknown as MwArgs, next as never);
  return { response: result as Response, context };
}

/** A clock that returns the given values in order (milliseconds). */
const clock = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

describe("resolveRequestId", () => {
  it("keeps a well-formed incoming ID and replaces anything else", () => {
    const gen = () => "generated-id-0001";
    assert.equal(resolveRequestId("abc-123_DEF.456", gen), "abc-123_DEF.456");
    for (const bad of [
      null,
      undefined,
      "",
      "short",
      "has space in it",
      "x".repeat(200),
      "bad\r\nheader: injected",
      "<script>",
    ]) {
      assert.equal(resolveRequestId(bad, gen), "generated-id-0001", String(bad));
    }
  });

  it("generates a UUID by default", () => {
    assert.match(resolveRequestId(null), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("request scope middleware", () => {
  it("propagates an incoming request ID to the response, the logger and downstream code", async () => {
    const { deps, log } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps, { now: clock(100, 112.5) });
    const request = new Request("https://app.test/submissions?token=QUERYSECRET", {
      headers: {
        [REQUEST_ID_HEADER]: "trace-from-proxy-01",
        cookie: `sid=${SECRET}`,
        authorization: `Bearer ${SECRET}`,
      },
    });

    let seenInside = "";
    const context = new RouterContextProvider();
    const { response } = await run(
      mw,
      request,
      async () => {
        const scope = getRequestScope(context);
        seenInside = scope.requestId;
        scope.logger.info("loader ran"); // a downstream log call is automatically stamped with the ID
        return new Response("ok");
      },
      context,
    );

    assert.equal(seenInside, "trace-from-proxy-01");
    assert.equal(response.headers.get(REQUEST_ID_HEADER), "trace-from-proxy-01");
    assert.equal(getRequestScope(context).requestId, "trace-from-proxy-01");

    const [downstream, summary] = log.records();
    assert.equal(downstream.requestId, "trace-from-proxy-01");
    assert.equal(summary.requestId, "trace-from-proxy-01");
    assert.equal(summary.method, "GET");
    assert.equal(summary.path, "/submissions");
    assert.equal(summary.status, 200);
    assert.equal(summary.durationMs, 12.5);
    // Nothing sensitive from the request ever reaches the log.
    assert.ok(!/QUERYSECRET/.test(log.text()) && !log.text().includes(SECRET));
  });

  it("logs only a fixed, non-sensitive set of fields per request", async () => {
    const { deps, log } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps);
    await run(
      mw,
      new Request("https://app.test/a?x=1", { method: "POST", body: "payload=secret" }),
      async () => new Response("ok"),
    );
    const [summary] = log.records();
    assert.deepEqual(Object.keys(summary).sort(), [
      "durationMs",
      "level",
      "method",
      "msg",
      "path",
      "requestId",
      "service",
      "status",
      "time",
    ]);
    assert.ok(!log.text().includes("payload"));
  });

  it("generates an ID when the incoming one is missing or unsafe", async () => {
    const { deps } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps, { generateId: () => "generated-id-0001" });
    const missing = await run(mw, new Request("https://app.test/"), async () => new Response("ok"));
    assert.equal(missing.response.headers.get(REQUEST_ID_HEADER), "generated-id-0001");
    const unsafe = await run(
      mw,
      new Request("https://app.test/", { headers: { [REQUEST_ID_HEADER]: "not valid!!" } }),
      async () => new Response("ok"),
    );
    assert.equal(unsafe.response.headers.get(REQUEST_ID_HEADER), "generated-id-0001");
  });

  it("does not touch the database (dependencies stay lazy)", async () => {
    const { deps, dbCalls } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps);
    await run(mw, new Request("https://app.test/"), async () => new Response("ok"));
    assert.equal(dbCalls(), 0);
  });

  it("logs 5xx responses at error level and others at info", async () => {
    const { deps, log } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps);
    await run(mw, new Request("https://app.test/a"), async () => new Response("x", { status: 404 }));
    await run(mw, new Request("https://app.test/b"), async () => new Response("x", { status: 503 }));
    assert.deepEqual(
      log.records().map((r) => [r.status, r.level]),
      [
        [404, "info"],
        [503, "error"],
      ],
    );
  });

  it("logs a thrown error with the request ID (scrubbed) and rethrows it unchanged", async () => {
    const { deps, log } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps, { generateId: () => "generated-id-0001" });
    const boom = new Error(`db down postgresql://u:${SECRET}@h/db`);
    await assert.rejects(
      run(mw, new Request("https://app.test/x"), async () => {
        throw boom;
      }),
      (e: unknown) => e === boom,
    );
    const [r] = log.records();
    assert.equal(r.level, "error");
    assert.equal(r.requestId, "generated-id-0001");
    assert.equal(r.err?.type, "Error");
    assert.ok(!log.text().includes(SECRET));
  });

  it("treats a thrown Response (e.g. a redirect) as control flow, not a failure", async () => {
    const { deps, log } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps, { generateId: () => "generated-id-0001" });
    const { response } = await run(mw, new Request("https://app.test/x"), async () => {
      throw new Response(null, { status: 302, headers: { location: "/login" } });
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get(REQUEST_ID_HEADER), "generated-id-0001");
    assert.equal(log.records()[0].level, "info");
  });

  it("can stamp the ID on responses with immutable headers", async () => {
    const { deps } = makeDeps();
    const mw = createRequestScopeMiddleware(() => deps, { generateId: () => "generated-id-0001" });
    const { response } = await run(mw, new Request("https://app.test/x"), async () =>
      Response.redirect("https://app.test/y", 302),
    );
    assert.equal(response.headers.get(REQUEST_ID_HEADER), "generated-id-0001");
    assert.equal(response.status, 302);
  });

  it("getRequestScope fails loudly when the middleware did not run", () => {
    assert.throws(() => getRequestScope(new RouterContextProvider()), /Request scope is missing/);
    assert.equal(new RouterContextProvider().get(appContext), null);
  });
});
