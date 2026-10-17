import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNoopLogger, createPrettyDestination, resolveLogConfig } from "../app/logging/logger.server.ts";
import { OMITTED, REDACTED, sanitize, sanitizeString, serializeError } from "../app/logging/sanitize.server.ts";
import { captureLogs } from "./helpers.ts";

const SECRET = "s3cr3t-value-123";
const asJson = (v: unknown) => JSON.stringify(v);

describe("sanitize: sensitive keys", () => {
  const sensitiveKeys = [
    "password",
    "passwd",
    "userPassword",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "idToken",
    "authorization",
    "Authorization",
    "cookie",
    "set-cookie",
    "sessionId",
    "session",
    "apiKey",
    "api_key",
    "privateKey",
    "signingKey",
    "clientSecret",
    "databaseUrl",
    "DATABASE_URL",
    "connectionString",
    "csrfToken",
    "x-amz-security-token",
    "BETTER_AUTH_SECRET",
  ];

  for (const key of sensitiveKeys) {
    it(`redacts "${key}"`, () => {
      assert.equal((sanitize({ [key]: SECRET }) as Record<string, unknown>)[key], REDACTED);
    });
  }

  it("redacts secrets nested in objects and arrays, but keeps harmless fields", () => {
    const out = sanitize({
      requestId: "abc-123",
      status: 200,
      path: "/submissions",
      deep: { a: { b: [{ token: SECRET }, { ok: true }] } },
    }) as Record<string, unknown>;
    assert.ok(!asJson(out).includes(SECRET));
    assert.equal(out.requestId, "abc-123");
    assert.equal(out.status, 200);
    assert.equal(out.path, "/submissions");
    assert.deepEqual((out.deep as { a: { b: unknown[] } }).a.b[1], { ok: true });
  });
});

// Assembled at runtime so no secret-shaped literal sits in the source (secret scanners rightly flag those).
const JWT_SAMPLE = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "SIGNATUREPART123"].join(".");

describe("sanitize: secrets inside strings", () => {
  const cases: Array<[string, string, string]> = [
    ["postgres URL", `connect failed: postgresql://vshow:${SECRET}@127.0.0.1:5432/vshow`, SECRET],
    ["neon URL", `postgres://u:${SECRET}@ep-a-1-pooler.eu.aws.neon.tech/db?sslmode=require`, SECRET],
    ["other URL credentials", `fetching https://admin:${SECRET}@example.com/x`, SECRET],
    ["bearer token", `header was Bearer ${SECRET}.abc`, SECRET],
    ["JWT", `token ${JWT_SAMPLE}`, "SIGNATUREPART123"],
    ["AWS access key", "key AKIAIOSFODNN7EXAMPLE leaked", "AKIAIOSFODNN7EXAMPLE"],
    [
      "presigned URL signature",
      "https://b.s3.amazonaws.com/k?X-Amz-Credential=AKIAXXXXXXXXXXXXXXXX&X-Amz-Signature=deadbeefcafe&X-Amz-Expires=60",
      "deadbeefcafe",
    ],
    ["key=value pair", `retry with password=${SECRET} now`, SECRET],
    ["quoted key=value", `config: token="${SECRET}"`, SECRET],
    [
      "private key block",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----",
      "MIIEvQIBADANBgkq",
    ],
    ["email address", "user jane.doe@example.org failed", "jane.doe@example.org"],
  ];

  for (const [name, input, secret] of cases) {
    it(`scrubs a ${name}`, () => {
      const out = sanitizeString(input);
      assert.ok(!out.includes(secret), `still contains the secret: ${out}`);
    });
  }

  it("leaves ordinary text alone and truncates very long strings", () => {
    assert.equal(sanitizeString("request completed in 12ms"), "request completed in 12ms");
    assert.ok(sanitizeString("x".repeat(5000)).length < 2100);
  });
});

describe("sanitize: structure and unsafe values", () => {
  it("omits personal data and request bodies by key", () => {
    const out = sanitize({
      email: "a@b.org",
      phone: "123",
      ip: "10.0.0.1",
      userAgent: "UA",
      body: { title: "x" },
      formData: "x",
    }) as Record<string, unknown>;
    for (const v of Object.values(out)) assert.equal(v, OMITTED);
  });

  it("never logs binary data", () => {
    assert.match(String(sanitize(Buffer.from("secret media bytes"))), /OMITTED/);
    assert.match(String(sanitize(new Uint8Array([1, 2, 3]))), /OMITTED/);
    assert.match(String(sanitize(new Blob(["x"]))), /OMITTED/);
    assert.ok(!asJson(sanitize({ upload: Buffer.from("secret media bytes") })).includes("secret media"));
  });

  it("handles cycles, deep nesting, hostile getters and class instances without throwing", () => {
    const cyclic: Record<string, unknown> = { name: "n" };
    cyclic.self = cyclic;
    assert.equal((sanitize(cyclic) as Record<string, unknown>).self, "[Circular]");

    let deep: Record<string, unknown> = { leaf: SECRET };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    assert.ok(!asJson(sanitize(deep)).includes(SECRET));

    const hostile = {
      get boom(): string {
        throw new Error("getter exploded");
      },
    };
    assert.equal((sanitize(hostile) as Record<string, unknown>).boom, "[unreadable]");

    class Internal {
      secretState = SECRET;
    }
    assert.equal(sanitize(new Internal()), "[Internal]");
  });

  it("summarises Request/Response/URL/Headers without leaking headers or query strings", () => {
    const req = new Request("https://app.test/p?token=QUERYSECRET", {
      headers: { authorization: `Bearer ${SECRET}`, cookie: `sid=${SECRET}` },
    });
    assert.deepEqual(sanitize(req), { method: "GET", path: "/p" });
    assert.equal(sanitize(new URL("https://app.test/p?token=QUERYSECRET#frag")), "https://app.test/p");
    const headers = sanitize(new Headers({ authorization: `Bearer ${SECRET}`, "x-request-id": "r-1" })) as Record<
      string,
      unknown
    >;
    assert.equal(headers.authorization, REDACTED);
    assert.equal(headers["x-request-id"], "r-1");
  });
});

describe("error serialization", () => {
  it("scrubs secrets from message, stack and causes", () => {
    const err = new Error(`connect failed postgresql://u:${SECRET}@h/db`, { cause: new Error(`password=${SECRET}`) });
    const out = serializeError(err);
    assert.equal(out.type, "Error");
    assert.ok(out.stack && out.stack.length > 0, "stack is kept for debugging");
    assert.ok(typeof out.cause === "object", "cause chain is kept");
    assert.ok(!asJson(out).includes(SECRET));
  });

  it("keeps PostgreSQL constraint/table names but never the row-value detail", () => {
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "app_user_email_unique",
      table: "app_user",
      detail: "Key (email)=(jane.doe@example.org) already exists.",
    });
    const out = serializeError(pgError);
    assert.equal(out.code, "23505");
    assert.equal(out.constraint, "app_user_email_unique");
    assert.equal(out.table, "app_user");
    assert.ok(!asJson(out).includes("jane.doe"));
    assert.ok(!("detail" in out));
  });

  it("describes non-Error throwables safely", () => {
    assert.ok(!asJson(serializeError(`token=${SECRET}`)).includes(SECRET));
    assert.equal(serializeError({ token: SECRET }).message, "[Object]");
    assert.equal(serializeError(null).message, "null");
  });
});

describe("logger (real Pino, in-memory destination)", () => {
  it("emits structured JSON with level label, ISO timestamp and service name", () => {
    const log = captureLogs();
    log.logger.info("hello", { status: 200 });
    const [r] = log.records();
    assert.equal(r.level, "info");
    assert.equal(r.msg, "hello");
    assert.equal(r.status, 200);
    assert.equal(r.service, "vshow");
    assert.match(String(r.time), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("redacts secrets in fields and in the message, wherever they appear", () => {
    const log = captureLogs();
    log.logger.warn(`failed using postgresql://u:${SECRET}@h/db`, {
      password: SECRET,
      nested: { refresh_token: SECRET, list: [{ apiKey: SECRET }] },
      headers: { authorization: `Bearer ${SECRET}`, cookie: `sid=${SECRET}` },
      note: `Bearer ${SECRET}`,
    });
    assert.ok(!log.text().includes(SECRET), log.text());
    assert.equal(log.records()[0].password, REDACTED);
  });

  it("applies redaction to child bindings too", () => {
    const log = captureLogs();
    const child = log.logger.child({ requestId: "req-1", token: SECRET });
    child.info("scoped");
    const [r] = log.records();
    assert.equal(r.requestId, "req-1");
    assert.equal(r.token, REDACTED);
    assert.ok(!log.text().includes(SECRET));
  });

  it("logs thrown errors under `err` with context, without secrets or internals", () => {
    const log = captureLogs();
    const err = Object.assign(new Error(`could not connect to postgresql://u:${SECRET}@h/db`), {
      code: "ECONNREFUSED",
    });
    log.logger.error("database failure", { err, operation: "load-submissions" });
    const [r] = log.records();
    assert.equal(r.level, "error");
    assert.equal(r.operation, "load-submissions");
    assert.equal(r.err?.type, "Error");
    assert.equal(r.err?.code, "ECONNREFUSED");
    assert.ok(typeof r.err?.stack === "string");
    assert.ok(!log.text().includes(SECRET));
  });

  it("does not log request objects' headers, cookies or query strings", () => {
    const log = captureLogs();
    const req = new Request("https://app.test/p?code=QUERYSECRET", {
      headers: { authorization: `Bearer ${SECRET}`, cookie: `sid=${SECRET}` },
    });
    log.logger.info("incoming", { req, body: "payload" });
    assert.ok(!/QUERYSECRET|payload/.test(log.text()));
    assert.ok(!log.text().includes(SECRET));
  });

  it("respects the configured level", () => {
    const log = captureLogs("info");
    log.logger.debug("hidden");
    log.logger.info("shown");
    assert.deepEqual(
      log.records().map((r) => r.msg),
      ["shown"],
    );
  });

  it("noop logger accepts everything and returns itself for child()", () => {
    const l = createNoopLogger();
    l.error("x", { err: new Error("y") });
    assert.equal(l.child({ a: 1 }), l);
  });
});

describe("log configuration", () => {
  it("defaults to debug in development and info in production/test", () => {
    assert.equal(resolveLogConfig({}).level, "debug");
    assert.equal(resolveLogConfig({ NODE_ENV: "production" }).level, "info");
    assert.equal(resolveLogConfig({ APP_ENV: "test" }).level, "info");
  });

  it("honours LOG_LEVEL case-insensitively and falls back on invalid values", () => {
    assert.equal(resolveLogConfig({ LOG_LEVEL: "WARN" }).level, "warn");
    assert.equal(resolveLogConfig({ LOG_LEVEL: "silent" }).level, "silent");
    const bad = resolveLogConfig({ NODE_ENV: "production", LOG_LEVEL: "loud" });
    assert.equal(bad.level, "info");
    assert.equal(bad.invalidLevel, "loud");
  });

  it("uses pretty output only for interactive non-production terminals unless forced", () => {
    assert.equal(resolveLogConfig({}, true).pretty, true);
    assert.equal(resolveLogConfig({}, false).pretty, false);
    assert.equal(resolveLogConfig({ NODE_ENV: "production" }, true).pretty, false);
    assert.equal(resolveLogConfig({ LOG_FORMAT: "json" }, true).pretty, false);
    assert.equal(resolveLogConfig({ LOG_FORMAT: "pretty", NODE_ENV: "production" }, false).pretty, true);
  });

  it("pretty destination formats JSON lines and passes through anything else", () => {
    const out: string[] = [];
    const dest = createPrettyDestination((t) => out.push(t));
    dest.write(JSON.stringify({ level: "info", time: "2026-01-02T03:04:05.678Z", msg: "hi", service: "vshow", a: 1 }));
    dest.write("not json");
    assert.match(out[0], /03:04:05\.678/);
    assert.match(out[0], /hi/);
    assert.match(out[0], /"a":1/);
    assert.equal(out[1], "not json");
  });
});
