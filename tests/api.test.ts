import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RouterContextProvider } from "react-router";
import { z } from "zod";
import {
  ApiError,
  apiErrorResponse,
  apiJson,
  toApiResponse,
  type ApiErrorBody,
} from "../app/server/api-response.server.ts";
import type { AppDeps } from "../app/server/container.server.ts";
import {
  REQUEST_ID_HEADER,
  createRequestScopeMiddleware,
  getRequestScope,
} from "../app/server/request-scope.server.ts";
import { MAX_JSON_BODY_BYTES, parseJsonBody, parseSearchParams } from "../app/server/validation.server.ts";
import { captureLogs, noAuth, noStorage, testMedia } from "./helpers.ts";

const SECRET = "s3cr3t-value-123";
const scopeFor = () => {
  const log = captureLogs();
  return { log, scope: { logger: log.logger, requestId: "req-api-0001" } };
};
const bodyOf = async (r: Response) => (await r.json()) as ApiErrorBody & { data?: unknown };
const jsonRequest = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/things", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });

const createSchema = z.object({
  title: z.string().min(3).max(50),
  kind: z.enum(["poster", "video"]),
  screens: z.array(z.object({ slot: z.number().int().min(1) })).max(5),
});

describe("API response convention", () => {
  it("success: { data } with JSON and no-store headers", async () => {
    const r = apiJson({ id: 1 }, { status: 201 });
    assert.equal(r.status, 201);
    assert.match(r.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(await r.json(), { data: { id: 1 } });
  });

  it("failure: { error: { code, message, requestId } } with the status preserved and the ID in header and body", async () => {
    const r = apiErrorResponse(new ApiError(404), "req-1");
    assert.equal(r.status, 404);
    assert.equal(r.headers.get(REQUEST_ID_HEADER), "req-1");
    assert.deepEqual(await r.json(), {
      error: { code: "not_found", message: "The requested resource was not found.", requestId: "req-1" },
    });
  });

  it("uses sensible default codes and lets callers override code and message", () => {
    assert.equal(new ApiError(401).code, "unauthorized");
    assert.equal(new ApiError(409).code, "conflict");
    const custom = new ApiError(409, { code: "version_changed", message: "A newer version exists." });
    assert.deepEqual([custom.code, custom.message], ["version_changed", "A newer version exists."]);
  });
});

describe("toApiResponse: safe error mapping", () => {
  it("maps ApiError to its status and logs it at info (an expected outcome)", async () => {
    const { log, scope } = scopeFor();
    const r = toApiResponse(new ApiError(403), scope);
    assert.equal(r.status, 403);
    assert.equal((await bodyOf(r)).error.code, "forbidden");
    assert.deepEqual(
      log.records().map((x) => [x.level, x.status, x.code]),
      [["info", 403, "forbidden"]],
    );
  });

  it("turns an unknown error into a generic 500 and never leaks its message, stack or secrets", async () => {
    const { log, scope } = scopeFor();
    const internal = new Error(`connect failed postgresql://u:${SECRET}@db.internal/x`);
    const r = toApiResponse(internal, scope);
    const text = JSON.stringify(await bodyOf(r));
    assert.equal(r.status, 500);
    assert.ok(!text.includes(SECRET) && !text.includes("db.internal") && !text.includes("connect failed"));
    assert.ok(!text.includes("stack"));
    assert.equal((JSON.parse(text) as ApiErrorBody).error.requestId, "req-api-0001");
    // The real error is logged server-side, scrubbed.
    const [rec] = log.records();
    assert.equal(rec.level, "error");
    assert.equal(rec.err?.type, "Error");
    assert.ok(!log.text().includes(SECRET));
  });

  it("returns a thrown Response (e.g. a redirect) unchanged", () => {
    const { scope } = scopeFor();
    const redirect = new Response(null, { status: 302, headers: { location: "/login" } });
    assert.equal(toApiResponse(redirect, scope), redirect);
  });

  it("maps ZodError to 422 with field paths and codes only, never the submitted values", async () => {
    const { scope } = scopeFor();
    const parsed = createSchema.safeParse({ title: SECRET.slice(0, 1), kind: SECRET, screens: [{ slot: 0 }] });
    assert.ok(!parsed.success);
    const r = toApiResponse(parsed.error, scope);
    const body = await bodyOf(r);
    assert.equal(r.status, 422);
    assert.equal(body.error.code, "validation_failed");
    assert.ok(body.error.issues && body.error.issues.length >= 3);
    for (const issue of body.error.issues) assert.deepEqual(Object.keys(issue).sort(), ["code", "path"]);
    assert.ok(body.error.issues.some((i) => i.path === "screens.0.slot"));
    assert.ok(!JSON.stringify(body).includes(SECRET));
  });
});

describe("request validation at the route boundary", () => {
  const valid = { title: "Poster", kind: "poster", screens: [{ slot: 1 }] };

  it("returns typed data for valid JSON", async () => {
    assert.deepEqual(await parseJsonBody(jsonRequest(JSON.stringify(valid)), createSchema), valid);
  });

  it("rejects a wrong content type with 415", async () => {
    const req = jsonRequest(JSON.stringify(valid), { "content-type": "text/plain" });
    await assert.rejects(parseJsonBody(req, createSchema), (e) => e instanceof ApiError && e.status === 415);
  });

  it("rejects malformed JSON with 400 and does not echo any of the body", async () => {
    const { scope } = scopeFor();
    const error = await parseJsonBody(jsonRequest(`{"password":"${SECRET}"`), createSchema).catch((e) => e);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_json");
    assert.ok(!JSON.stringify(await bodyOf(toApiResponse(error, scope))).includes(SECRET));
  });

  it("rejects an oversized body: by Content-Length and by actual streamed size", async () => {
    const big = JSON.stringify({ title: "x".repeat(2000) });
    await assert.rejects(
      parseJsonBody(jsonRequest(big, { "content-length": "99999999" }), createSchema),
      (e) => e instanceof ApiError && e.status === 413,
    );
    await assert.rejects(
      parseJsonBody(jsonRequest(big), createSchema, { maxBytes: 500 }),
      (e) => e instanceof ApiError && e.status === 413,
    );
    assert.equal(MAX_JSON_BODY_BYTES, 1_000_000);
  });

  it("returns 422 with paths/codes only, never values, for schema failures", async () => {
    const { scope } = scopeFor();
    const error = await parseJsonBody(
      jsonRequest(JSON.stringify({ ...valid, title: "x", kind: SECRET })),
      createSchema,
    ).catch((e) => e);
    assert.ok(error instanceof ApiError && error.status === 422);
    const text = JSON.stringify(await bodyOf(toApiResponse(error, scope)));
    assert.ok(!text.includes(SECRET));
    assert.ok(text.includes('"path":"kind"') && text.includes('"path":"title"'));
  });

  it("validates the query string, coercing types and collecting repeated keys", () => {
    const schema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      tag: z.array(z.string()).or(z.string()),
    });
    const out = parseSearchParams({ url: "https://app.test/x?page=3&tag=a&tag=b" }, schema);
    assert.deepEqual(out, { page: 3, tag: ["a", "b"] });
  });

  it("rejects a bad query with invalid_query and no echoed values", () => {
    const schema = z.object({ page: z.coerce.number().int().min(1) });
    const error = (() => {
      try {
        parseSearchParams({ url: `https://app.test/x?page=${SECRET}` }, schema);
      } catch (e) {
        return e;
      }
    })();
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 422);
    assert.equal(error.code, "invalid_query");
    assert.ok(!JSON.stringify(error.issues).includes(SECRET));
  });
});

describe("a resource route end to end (middleware + validation + error mapping, no real infrastructure)", () => {
  // The shape future API routes will follow: native async action, explicit try/catch at the boundary.
  async function action({ request, context }: { request: Request; context: RouterContextProvider }) {
    const scope = getRequestScope(context);
    try {
      const input = await parseJsonBody(request, createSchema);
      if (input.title === "boom") throw new Error(`db exploded postgresql://u:${SECRET}@h/db`);
      return apiJson({ created: input.title }, { status: 201 });
    } catch (error) {
      return toApiResponse(error, scope);
    }
  }

  async function call(body: string) {
    const log = captureLogs();
    const deps: AppDeps = {
      logger: log.logger,
      database: { get: () => assert.fail("no DB"), close: async () => {} },
      auth: noAuth,
      storage: noStorage,
      media: testMedia,
    };
    const mw = createRequestScopeMiddleware(() => deps, { generateId: () => "generated-id-0001" });
    const context = new RouterContextProvider();
    const request = jsonRequest(body, { [REQUEST_ID_HEADER]: "client-trace-id-01" });
    const response = (await mw(
      { request, params: {}, context } as never,
      (async () => action({ request, context })) as never,
    )) as Response;
    return { response, log };
  }

  it("succeeds with the request ID on the response", async () => {
    const { response } = await call(JSON.stringify({ title: "Poster", kind: "poster", screens: [] }));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get(REQUEST_ID_HEADER), "client-trace-id-01");
    assert.deepEqual((await bodyOf(response)).data, { created: "Poster" });
  });

  it("returns a safe 422 and the same request ID in header and body", async () => {
    const { response } = await call(JSON.stringify({ title: "x" }));
    const body = await bodyOf(response);
    assert.equal(response.status, 422);
    assert.equal(body.error.requestId, "client-trace-id-01");
    assert.equal(response.headers.get(REQUEST_ID_HEADER), "client-trace-id-01");
  });

  it("returns a generic 500 for an internal failure while logging the cause with the request ID", async () => {
    const { response, log } = await call(JSON.stringify({ title: "boom", kind: "poster", screens: [] }));
    const text = JSON.stringify(await bodyOf(response));
    assert.equal(response.status, 500);
    assert.ok(!text.includes(SECRET) && !text.includes("exploded"));
    const failure = log.records().find((r) => r.msg === "api request failed");
    assert.equal(failure?.requestId, "client-trace-id-01");
    assert.ok(!log.text().includes(SECRET));
  });
});
