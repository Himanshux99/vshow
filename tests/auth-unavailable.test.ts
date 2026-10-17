// What happens when authentication is UNAVAILABLE because its configuration is missing or invalid (for example
// no vauth client credentials yet). The guards must answer with a fixed 503 and grant nothing; only that one
// kind of error is treated this way, so genuine failures and programming errors are never hidden.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTH_UNAVAILABLE_MESSAGE,
  assertSameHost,
  authUnavailable,
  requireApiRole,
  requireAssignedUser,
  requireRole,
  requireUnassigned,
} from "../app/auth/authorize.server.ts";
import { handleDevLogin } from "../app/auth/dev-login.server.ts";
import { AuthConfigError, COOKIE_PREFIX } from "../app/auth/config.server.ts";
import { AUTH_COOKIE_NAMES, expiredAuthCookies } from "../app/auth/session-cookies.server.ts";
import { ApiError } from "../app/server/api-response.server.ts";
import { captureLogs } from "./helpers.ts";

/** A scope whose auth provider fails with `failure` the moment it is used. The database must never be touched. */
function scopeWhereAuthFails(failure: Error) {
  const log = captureLogs();
  const scope = {
    auth: {
      devAuth: { enabled: false },
      config() {
        throw failure;
      },
      get(): never {
        throw failure;
      },
    },
    database: {
      get(): never {
        throw new Error("the database must not be used while authentication is unavailable");
      },
      close: async () => {},
    },
    logger: log.logger,
  };
  return { scope, log };
}
const request = () => new Request("http://localhost:5173/me");
const missing = () => new AuthConfigError("VOSS_CLIENT_ID is not set.");
const thrown = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

interface Unavailable {
  data?: unknown;
  init?: { status?: number; statusText?: string };
}

describe("page guards when authentication configuration is missing", () => {
  const guards: Array<[string, (s: ReturnType<typeof scopeWhereAuthFails>["scope"]) => Promise<unknown>]> = [
    ["requireRole", (s) => requireRole(s, request(), ["ADMIN"])],
    ["requireAssignedUser (used by /me)", (s) => requireAssignedUser(s, request())],
    ["requireUnassigned (used by /unclaimed)", (s) => requireUnassigned(s, request())],
  ];

  for (const [name, call] of guards) {
    it(`${name} answers a fixed 503 and never returns a user`, async () => {
      const { scope } = scopeWhereAuthFails(missing());
      const err = (await thrown(call(scope))) as Unavailable;
      assert.equal(err?.init?.status, 503);
      assert.equal(err?.init?.statusText, "Service Unavailable");
      assert.equal(err?.data, AUTH_UNAVAILABLE_MESSAGE);
      const everything = JSON.stringify(err);
      assert.ok(!/VOSS_CLIENT|AuthConfigError|stack/.test(everything), "the response says nothing about the cause");
    });
  }

  it("logs the reason once (variable name only, no exception object, no stack)", async () => {
    const { scope, log } = scopeWhereAuthFails(missing());
    await thrown(requireAssignedUser(scope, request()));
    const records = log.records().filter((r) => r.msg === "authentication is not configured correctly");
    assert.equal(records.length, 1);
    assert.equal(records[0].level, "error");
    assert.equal(records[0].reason, "VOSS_CLIENT_ID is not set.");
    assert.ok(!("err" in records[0]) && !log.text().includes("stack"));
  });

  it("applies to an INVALID configuration too, not just missing credentials", async () => {
    const { scope } = scopeWhereAuthFails(new AuthConfigError("BETTER_AUTH_URL must use https in production."));
    assert.equal(((await thrown(requireAssignedUser(scope, request()))) as Unavailable)?.init?.status, 503);
  });

  it("authUnavailable() itself throws the same fixed 503", () => {
    const { scope } = scopeWhereAuthFails(missing());
    assert.throws(
      () => authUnavailable(scope, missing()),
      (e: unknown) => (e as Unavailable).init?.status === 503 && (e as Unavailable).data === AUTH_UNAVAILABLE_MESSAGE,
    );
  });

  it("an empty allowlist is still a programming error, reported before authentication is even consulted", async () => {
    const { scope } = scopeWhereAuthFails(missing());
    await assert.rejects(requireRole(scope, request(), []), /at least one allowed role/);
  });
});

describe("API guard when authentication configuration is missing", () => {
  it("answers the standard safe JSON error with status 503", async () => {
    const { scope, log } = scopeWhereAuthFails(missing());
    const err = await thrown(requireApiRole(scope, request(), ["ADMIN"]));
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 503);
    assert.equal(err.code, "service_unavailable");
    assert.ok(!/VOSS_CLIENT/.test(err.message));
    assert.equal(log.records().filter((r) => r.reason === "VOSS_CLIENT_ID is not set.").length, 1);
  });
});

describe("only a configuration problem is treated as 'unavailable'", () => {
  const unrelated: Array<[string, Error]> = [
    ["a generic programming error", new Error("boom: unexpected internal failure")],
    ["a TypeError", new TypeError("cannot read properties of undefined")],
    ["a database failure", Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })],
  ];

  for (const [name, failure] of unrelated) {
    it(`${name} keeps propagating unchanged from the page and API guards`, async () => {
      const { scope } = scopeWhereAuthFails(failure);
      assert.equal(await thrown(requireRole(scope, request(), ["ADMIN"])), failure);
      assert.equal(await thrown(requireUnassigned(scope, request())), failure);
      assert.equal(await thrown(requireApiRole(scope, request(), ["ADMIN"])), failure);
    });
  }

  it("such errors are not logged as a configuration problem", async () => {
    const { scope, log } = scopeWhereAuthFails(new Error("boom"));
    await thrown(requireAssignedUser(scope, request()));
    assert.equal(log.records().filter((r) => r.msg === "authentication is not configured correctly").length, 0);
  });
});

describe("assertSameHost (the foreign-origin check used by the degraded sign-out)", () => {
  const post = (origin?: string) =>
    new Request("http://vshow.example.test/logout", { method: "POST", headers: origin ? { origin } : {} });
  const status = (fn: () => void) => {
    try {
      fn();
      return 0;
    } catch (e) {
      return (e as Unavailable).init?.status ?? -1;
    }
  };

  it("accepts a same-host origin (any scheme) and a request with no Origin header", () => {
    assert.equal(
      status(() => assertSameHost(post("https://vshow.example.test"))),
      0,
    );
    assert.equal(
      status(() => assertSameHost(post("http://vshow.example.test"))),
      0,
    );
    assert.equal(
      status(() => assertSameHost(post())),
      0,
    );
  });

  it("refuses every other origin with 403", () => {
    for (const evil of [
      "https://evil.example",
      "https://vshow.example.test.evil.example",
      "http://vshow.example.test:8080",
      "null",
      "not a url",
    ]) {
      assert.equal(
        status(() => assertSameHost(post(evil))),
        403,
        evil,
      );
    }
  });
});

describe("local sign-out cookie clearing (used when Better Auth cannot run)", () => {
  const cookies = expiredAuthCookies();

  it("expires every auth cookie in both its plain and __Secure- forms, with an empty value", () => {
    for (const name of AUTH_COOKIE_NAMES) {
      const plain = cookies.find((c) => c.startsWith(`${COOKIE_PREFIX}.${name}=;`));
      const secure = cookies.find((c) => c.startsWith(`__Secure-${COOKIE_PREFIX}.${name}=;`));
      assert.ok(plain && secure, `${name} must be cleared in both forms`);
      assert.match(plain, /Max-Age=0/i);
      assert.match(secure, /Max-Age=0/i);
      assert.doesNotMatch(plain, /;\s*Secure/i);
      assert.match(secure, /;\s*Secure/i, "__Secure- cookies can only be cleared with the Secure attribute");
    }
    assert.equal(cookies.length, AUTH_COOKIE_NAMES.length * 2);
  });

  it("is HttpOnly, SameSite=Lax and path-wide, like the cookies it clears", () => {
    for (const c of cookies) assert.ok(/HttpOnly/i.test(c) && /SameSite=Lax/i.test(c) && /Path=\//.test(c), c);
  });
});

describe("dev identity switcher enabled but BETTER_AUTH_SECRET missing", () => {
  const post = () =>
    new Request("http://localhost:5173/dev/login", {
      method: "POST",
      headers: { origin: "http://localhost:5173", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ identity: "admin" }),
    });
  const scopeFor = (failure: Error, calls: string[]) => {
    const log = captureLogs();
    return {
      log,
      scope: {
        auth: {
          devAuth: { enabled: true },
          config(): never {
            throw failure;
          },
          get(): never {
            calls.push("get");
            throw failure;
          },
        },
        logger: log.logger,
      },
    };
  };

  it("answers the fixed 503, creates no session and issues no cookie", async () => {
    const calls: string[] = [];
    const { scope, log } = scopeFor(new AuthConfigError("BETTER_AUTH_SECRET is not set."), calls);
    const err = (await thrown(handleDevLogin(scope as never, post()))) as Unavailable;
    assert.equal(err?.init?.status, 503);
    assert.equal(err?.data, AUTH_UNAVAILABLE_MESSAGE);
    assert.ok(!(err instanceof Response), "nothing resembling a redirect or Set-Cookie response is returned");
    assert.ok(!/BETTER_AUTH|stack/.test(JSON.stringify(err)));
    assert.deepEqual(calls, [], "Better Auth is never built, so no sign-in can happen");
    const rec = log.records().filter((r) => r.msg === "authentication is not configured correctly");
    assert.equal(rec.length, 1);
    assert.equal(rec[0].reason, "BETTER_AUTH_SECRET is not set.");
    assert.ok(!("err" in rec[0]));
  });

  it("still answers 404 when the switcher is disabled, before anything else", async () => {
    const { scope } = scopeFor(new AuthConfigError("BETTER_AUTH_SECRET is not set."), []);
    scope.auth.devAuth.enabled = false;
    assert.equal(((await thrown(handleDevLogin(scope as never, post()))) as Unavailable)?.init?.status, 404);
  });

  it("does not hide unrelated failures", async () => {
    const failure = new Error("connect ECONNREFUSED");
    const { scope } = scopeFor(failure, []);
    assert.equal(await thrown(handleDevLogin(scope as never, post())), failure);
  });
});
