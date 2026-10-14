// Builds the app once, checks that no server-only code leaked into the browser bundle, then runs the REAL
// production server (react-router-serve) and exercises the authentication routes over HTTP.
// This test does not contact vauth: every request used here is answered before any identity-provider call.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { VAUTH } from "../app/auth/config.server.ts";
import { createThrowawayDb, runNode } from "./helpers.ts";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const build = spawnSync(process.execPath, ["node_modules/@react-router/dev/bin.cjs", "build"], {
  encoding: "utf8",
  timeout: 120_000,
  env: { ...process.env, VSHOW_DEV_AUTH: "" },
});

describe("production build", () => {
  it("builds", () => {
    assert.equal(build.status, 0, build.stderr.slice(-600) || build.stdout.slice(-600));
  });

  it("keeps server-only code, auth libraries and secrets' names out of the browser bundle", () => {
    const files = walk("build/client").filter((f) => /\.(js|mjs|css|html|json|map)$/.test(f));
    assert.ok(files.length > 0);
    const forbidden = [
      "pino",
      "node-postgres",
      "drizzle-orm",
      "better-auth",
      "better-call",
      "jose",
      "DATABASE_URL",
      "BETTER_AUTH",
      "VOSS_CLIENT",
      "x-request-id",
      "createRequestScopeMiddleware",
      "sanitizeString",
      "getUserInfo",
      "vshow-dev-switcher",
      "/dev/sign-in",
      "oauth2/callback",
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const needle of forbidden) assert.ok(!text.includes(needle), `${f} contains "${needle}"`);
    }
    const server = walk("build/server").filter((f) => f.endsWith(".js"));
    assert.ok(server.some((f) => readFileSync(f, "utf8").includes("request completed")));
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

describe("running production server", async () => {
  const db = await createThrowawayDb("vshow_test_srv");
  const opts = { skip: db.skipReason || build.status !== 0 ? db.skipReason || "build failed" : false };
  const ORIGIN = "https://vshow.example.test";
  // The server is reached over plain http here, so React Router's own origin check (scheme+host) accepts only this.
  const HTTP_ORIGIN = ORIGIN.replace("https:", "http:");
  const SECRET_CODE = "OAUTHCODE-must-never-be-logged-0123";
  const SECRET_STATE = "OAUTHSTATE-must-never-be-logged-4567";
  let child: ChildProcess | undefined;
  let port = 0;
  let stdout = "";

  before(async () => {
    if (db.skipReason || build.status !== 0) return;
    const migrate = runNode(["scripts/db-migrate.ts"], {
      DB_TARGET: "local",
      DATABASE_URL: db.url,
      DATABASE_URL_DIRECT: "",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    port = await freePort();
    child = spawn(process.execPath, ["node_modules/@react-router/serve/dist/cli.js", "./build/server/index.js"], {
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        PORT: String(port),
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        DB_TARGET: "local",
        DATABASE_URL: db.url,
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), // random per run: no secret-shaped literal in source
        BETTER_AUTH_URL: ORIGIN,
        VOSS_DISCOVERY_URL: VAUTH.discoveryUrl,
        VOSS_CLIENT_ID: "e2e-client-id",
        VOSS_CLIENT_SECRET: randomBytes(16).toString("hex"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stdout += d.toString()));
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/login`)).status === 200) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`server did not start:\n${stdout}`);
  });
  after(async () => {
    child?.kill();
    await new Promise((r) => setTimeout(r, 300));
    if (!db.skipReason) await db.drop();
  });

  // The server is reached on loopback but addressed as the configured host (Host header), so React Router's own
  // origin-versus-host check and Vshow's origin check both see a consistent same-site request.
  interface Res {
    status: number;
    headers: Headers;
    text(): Promise<string>;
  }
  const get = (
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams } = {},
  ) =>
    new Promise<Res>((resolve, reject) => {
      const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
      const headers: Record<string, string> = { host: new URL(ORIGIN).host, ...(init.headers ?? {}) };
      if (init.body instanceof URLSearchParams) headers["content-type"] = "application/x-www-form-urlencoded";
      if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
      const req = httpRequest({ host: "127.0.0.1", port, path, method: init.method ?? "GET", headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
            else if (v !== undefined) h.set(k, v);
          }
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, headers: h, text: async () => text });
        });
      });
      req.on("error", reject);
      req.end(body);
    });

  it("serves the login page with the sign-in button and a request ID", opts, async () => {
    const res = await get("/login");
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("x-request-id"));
    const html = await res.text();
    assert.match(html, /Sign in with VOSS/);
    assert.doesNotMatch(html, /Local development identity switcher/);
  });

  it("protected pages redirect an anonymous visitor to /login", opts, async () => {
    for (const path of ["/me", "/unclaimed"]) {
      const res = await get(path);
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.get("location"), "/login", path);
    }
  });

  it("the development switcher does not exist: page 404, POST 404, API 404", opts, async () => {
    assert.equal((await get("/dev/login")).status, 404);
    const post = await get("/dev/login", {
      method: "POST",
      headers: { origin: HTTP_ORIGIN },
      body: new URLSearchParams({ identity: "admin" }),
    });
    assert.equal(post.status, 404, `POST /dev/login -> ${post.status}: ${(await post.text()).slice(0, 300)}`);
    const api = await get("/api/auth/dev/sign-in", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ identity: "admin" }),
    });
    assert.equal(api.status, 404);
    assert.equal(api.headers.getSetCookie().length, 0);
  });

  it("denies every /api/auth endpoint Vshow does not use, with no-store and no-referrer headers", opts, async () => {
    const cases: Array<[string, string]> = [
      ["GET", "/api/auth/get-session"],
      ["POST", "/api/auth/sign-in/email"],
      ["POST", "/api/auth/sign-up/email"],
      ["POST", "/api/auth/sign-out"],
      ["POST", "/api/auth/update-user"],
      ["POST", "/api/auth/callback/voss"],
      ["GET", "/api/auth/list-sessions"],
    ];
    for (const [method, path] of cases) {
      const res = await get(path, {
        method,
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    }
  });

  it(
    "the OAuth callback keeps working (state is validated), redirects to /login, and is never cacheable or leaky",
    opts,
    async () => {
      const res = await get(
        `/api/auth/oauth2/callback/voss?code=${SECRET_CODE}&state=${SECRET_STATE}&iss=${encodeURIComponent(VAUTH.issuer)}`,
      );
      assert.equal(res.status, 302);
      const location = new URL(res.headers.get("location") as string);
      assert.equal(location.origin + location.pathname, `${ORIGIN}/login`);
      assert.ok(location.searchParams.get("error"), "an unknown state is reported as an error");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(
        res.headers.getSetCookie().some((c) => c.includes("session_token=") && !/max-age=0/i.test(c)),
        false,
        "no session is issued",
      );
    },
  );

  it("Vshow's own log lines never contain the callback's code or state", opts, async () => {
    await new Promise((resolve) => setTimeout(resolve, 600)); // let the server flush its log pipe
    const vshowLines = stdout.split(/\r?\n/).filter((l) => l.startsWith("{"));
    assert.ok(
      vshowLines.some((l) => l.includes('"path":"/api/auth/oauth2/callback/voss"')),
      `the callback request was logged (path only). Logged paths: ${vshowLines.map((l) => (JSON.parse(l) as { path?: string }).path).join(", ")}`,
    );
    for (const line of vshowLines) {
      assert.ok(!line.includes(SECRET_CODE) && !line.includes(SECRET_STATE), `leaked: ${line.slice(0, 120)}`);
    }
  });

  it("the login page maps error codes to fixed text and never reflects the query string", opts, async () => {
    const page = async (code: string) => {
      const res = await get(`/login?error=${code}`);
      assert.equal(res.status, 200);
      return res.text();
    };
    const xss = await page(encodeURIComponent("<script>alert(1)</script>"));
    assert.doesNotMatch(xss, /<script>alert/);
    assert.match(xss, /Sign-in failed\. Please try again\./);

    // React Router embeds the URL in its (escaped) hydration payload; what must not happen is the value being
    // shown as page text, so look at the markup outside <script> blocks.
    const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
    const unknown = await page("some_unknown_code_12345");
    const v = visible(unknown);
    const at = v.indexOf("some_unknown_code_12345");
    assert.equal(at, -1, `value shown outside scripts: ...${v.slice(Math.max(0, at - 120), at + 60)}...`);
    assert.match(unknown, /Sign-in failed\. Please try again\./);

    assert.match(await page("state_mismatch"), /sign-in session expired/);
    assert.match(await page("inactive"), /has been deactivated/);
  });

  it("state-changing posts from a foreign origin are refused", opts, async () => {
    for (const path of ["/login", "/logout"]) {
      const res = await get(path, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: new URLSearchParams(),
      });
      // Refused by React Router's own origin check (400) or by Vshow's (403): never processed.
      assert.ok(res.status === 400 || res.status === 403, `${path} -> ${res.status}`);
      assert.equal(res.headers.getSetCookie().length, 0);
    }
  });

  it("GET /logout never signs anyone out", opts, async () => {
    const res = await get("/logout");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
  });

  it(
    "Vshow's own origin check refuses a post whose origin is not the configured one, even when React Router accepts it",
    opts,
    async () => {
      // HTTP_ORIGIN passes React Router's scheme+host check against this plain-http request, but it is not
      // BETTER_AUTH_URL (https), so Vshow's assertSameOrigin must reject it before anything happens.
      for (const path of ["/login", "/logout"]) {
        const res = await get(path, { method: "POST", headers: { origin: HTTP_ORIGIN }, body: new URLSearchParams() });
        assert.equal(res.status, 403, path);
        assert.equal(res.headers.getSetCookie().length, 0);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------------------
// Regression: authentication configuration missing (no vauth client credentials, dev switcher off).
// /me, /unclaimed, /logout and a direct POST /login used to answer 500; they must answer cleanly instead, while
// still granting nothing and never exposing the reason.
describe("running production server WITHOUT vauth credentials", async () => {
  const db = await createThrowawayDb("vshow_test_nocred");
  const opts = { skip: db.skipReason || build.status !== 0 ? db.skipReason || "build failed" : false };
  const ORIGIN = "https://vshow.example.test";
  const HTTP_ORIGIN = ORIGIN.replace("https:", "http:"); // what React Router's own origin check accepts over plain http
  const SESSION_SECRET = randomBytes(32).toString("hex");
  let child: ChildProcess | undefined;
  let port = 0;
  let stdout = "";

  before(async () => {
    if (db.skipReason || build.status !== 0) return;
    const migrate = runNode(["scripts/db-migrate.ts"], {
      DB_TARGET: "local",
      DATABASE_URL: db.url,
      DATABASE_URL_DIRECT: "",
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    port = await freePort();
    child = spawn(process.execPath, ["node_modules/@react-router/serve/dist/cli.js", "./build/server/index.js"], {
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        PORT: String(port),
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        DB_TARGET: "local",
        DATABASE_URL: db.url,
        BETTER_AUTH_SECRET: SESSION_SECRET,
        BETTER_AUTH_URL: ORIGIN,
        VOSS_DISCOVERY_URL: VAUTH.discoveryUrl,
        // VOSS_CLIENT_ID / VOSS_CLIENT_SECRET deliberately absent; VSHOW_DEV_AUTH absent (switcher off).
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stdout += d.toString()));
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/login`)).status === 200) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`server did not start:\n${stdout}`);
  });
  after(async () => {
    child?.kill();
    await new Promise((r) => setTimeout(r, 300));
    if (!db.skipReason) await db.drop();
  });

  interface Res {
    status: number;
    headers: Headers;
    body: string;
  }
  const send = (path: string, method = "GET", headers: Record<string, string> = {}, form?: URLSearchParams) =>
    new Promise<Res>((resolve, reject) => {
      const body = form?.toString();
      const h: Record<string, string> = { host: new URL(ORIGIN).host, ...headers };
      if (body !== undefined) {
        h["content-type"] = "application/x-www-form-urlencoded";
        h["content-length"] = String(Buffer.byteLength(body));
      }
      const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: h }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((x) => out.append(k, x));
            else if (v !== undefined) out.set(k, v);
          }
          resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks).toString("utf8") });
        });
      });
      req.on("error", reject);
      req.end(body);
    });

  // Nothing about the cause, the configuration or the runtime may reach the browser.
  const assertNothingLeaked = (res: Res, label: string) => {
    const headerText = JSON.stringify([...res.headers]);
    for (const needle of [
      "AuthConfigError",
      "VOSS_CLIENT",
      "BETTER_AUTH",
      SESSION_SECRET,
      "node_modules",
      "at async",
    ]) {
      assert.ok(!res.body.includes(needle), `${label}: response contains "${needle}"`);
      assert.ok(!headerText.includes(needle), `${label}: headers contain "${needle}"`);
    }
  };

  it("/me answers 503 (not 500) with fixed text, and grants nothing", opts, async () => {
    const res = await send("/me");
    assert.equal(res.status, 503);
    assert.match(res.body, /Service Unavailable/);
    assert.doesNotMatch(res.body, /REVIEWER|Roles/);
    assertNothingLeaked(res, "/me");
  });

  it("/unclaimed answers 503, not 500, and does not show the page", opts, async () => {
    const res = await send("/unclaimed");
    assert.equal(res.status, 503);
    assert.match(res.body, /Service Unavailable/);
    assert.doesNotMatch(res.body, /access is not set up yet/);
    assertNothingLeaked(res, "/unclaimed");
  });

  it("/logout ends the session locally: expires every auth cookie and redirects to /login", opts, async () => {
    const res = await send(
      "/logout",
      "POST",
      { origin: HTTP_ORIGIN, cookie: "vshow.session_token=stale.value" },
      new URLSearchParams(),
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/login");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const cookies = res.headers.getSetCookie();
    for (const name of ["vshow.session_token", "__Secure-vshow.session_token", "vshow.state"]) {
      assert.ok(
        cookies.some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c)),
        `${name} must be expired`,
      );
    }
    assert.ok(
      cookies.every((c) => !c.includes("stale.value")),
      "the stale value is never echoed back",
    );
    assertNothingLeaked(res, "/logout");
  });

  it("GET /logout still signs nobody out", opts, async () => {
    const res = await send("/logout");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
    assert.equal(res.headers.getSetCookie().length, 0);
  });

  it(
    "a direct POST /login answers 503: the form is not offered, but the action must not 500 either",
    opts,
    async () => {
      const res = await send("/login", "POST", { origin: HTTP_ORIGIN }, new URLSearchParams());
      assert.equal(res.status, 503);
      assert.equal(res.headers.getSetCookie().length, 0, "no OAuth state cookie is issued");
      assertNothingLeaked(res, "POST /login");
    },
  );

  it("the public pages and the other guards behave as before", opts, async () => {
    const login = await send("/login");
    assert.equal(login.status, 200);
    assert.match(login.body, /Sign-in is not available right now/);
    assert.doesNotMatch(login.body, /Sign in with VOSS/);
    assert.equal((await send("/dev/login")).status, 404, "the switcher is not enabled");
    assert.equal((await send("/api/auth/ok")).status, 503);
    assert.equal((await send("/api/auth/get-session")).status, 404, "default-deny is checked before configuration");
    const foreign = await send("/logout", "POST", { origin: "https://evil.example" }, new URLSearchParams());
    assert.equal(foreign.status, 403, "a foreign origin is refused by Vshow's host check, with no cookies touched");
    assert.equal(foreign.headers.getSetCookie().length, 0);
  });

  it("the cause is logged by variable name only: no exception object, no stack, no secret", opts, async () => {
    await send("/me");
    await new Promise((r) => setTimeout(r, 600)); // let the server flush its log pipe
    const lines = stdout.split(/\r?\n/).filter((l) => l.startsWith("{"));
    const reasons = lines.filter(
      (l) => (JSON.parse(l) as { msg?: string }).msg === "authentication is not configured correctly",
    );
    assert.ok(reasons.length >= 1);
    for (const l of reasons) {
      const rec = JSON.parse(l) as Record<string, unknown>;
      assert.equal(rec.level, "error");
      assert.match(String(rec.reason), /VOSS_CLIENT_ID is not set/);
      assert.ok(!("err" in rec) && !("stack" in rec), "no exception object or stack in the record");
    }
    for (const l of lines) assert.ok(!l.includes(SESSION_SECRET), "the session secret never reaches the logs");
  });
});
