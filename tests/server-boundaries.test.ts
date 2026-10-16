import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const norm = (p: string) => p.split("\\").join("/");
const appFiles = walk("app")
  .map(norm)
  .filter((f) => /\.(ts|tsx)$/.test(f));
const importsOf = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

describe("server-only boundaries (source)", () => {
  it("only `.server` modules import server libraries", () => {
    const serverLibs = /^(pino|pg|drizzle-orm\/node-postgres|node:)/;
    const offenders = appFiles.filter(
      (f) => !/\.server\.tsx?$/.test(f) && importsOf(f).some((i) => serverLibs.test(i)),
    );
    assert.deepEqual(offenders, []);
  });

  it("Pino is imported in exactly one module: the Vshow logger abstraction", () => {
    const users = appFiles.filter((f) => importsOf(f).includes("pino"));
    assert.deepEqual(users, ["app/logging/logger.server.ts"]);
  });

  it("the AWS SDK is imported by exactly one module: the Neon storage adapter", () => {
    const users = appFiles.filter((f) => importsOf(f).some((i) => i.startsWith("@aws-sdk/")));
    assert.deepEqual(users, ["app/storage/neon.server.ts"]);
  });

  it("workflow code reaches object storage only through the ObjectStorage interface", () => {
    const offenders = appFiles.filter(
      (f) =>
        (f.startsWith("app/submissions/") || f.startsWith("app/routes/") || f.startsWith("app/components/")) &&
        importsOf(f).some((i) => /storage\/(neon|config|provider|unconfigured)\.server/.test(i)),
    );
    assert.deepEqual(offenders, []);
  });

  it("process.env is read only by the composition root", () => {
    const readers = appFiles.filter((f) => /process\.env/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")));
    assert.deepEqual(readers, ["app/server/container.server.ts"]);
  });

  it("application code uses the logger, not console", () => {
    const offenders = appFiles.filter((f) => /\bconsole\.(log|error|warn|info|debug)\b/.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  });

  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("contains no automatic retry logic (writes must not be retried without an idempotency strategy)", () => {
    const offenders = appFiles.filter((f) =>
      /\b(retry|retries|retrying|backoff)\b/i.test(stripComments(readFileSync(f, "utf8"))),
    );
    assert.deepEqual(offenders, []);
  });

  it("the composition root delegates hosting differences to the platform adapter", () => {
    const src = stripComments(readFileSync("app/server/container.server.ts", "utf8"));
    assert.match(src, /selectPlatform\(/);
    assert.ok(!/attachDatabasePool|@vercel/.test(src));
  });

  it("no module-level singleton database exists any more", () => {
    // Local closures named getDb are fine; an exported/global accessor is not.
    assert.ok(!appFiles.some((f) => /export\s+(async\s+)?(function|const)\s+getDb\b/.test(readFileSync(f, "utf8"))));
  });

  it("route modules never import the logger, database driver or auth libraries directly", () => {
    const routes = appFiles.filter((f) => f.startsWith("app/routes/") || f === "app/root.tsx");
    for (const f of routes) {
      assert.ok(
        !importsOf(f).some((i) => /^(pino|pg|drizzle-orm|better-auth|better-call|jose)/.test(i)),
        relative(".", f),
      );
    }
  });

  it("every route is either explicitly public or calls its own authorization guard", () => {
    // Public on purpose: the landing page, the sign-in page and its OAuth plumbing, sign-out (harmless without
    // a session), and the dev page which answers 404 unless the switcher is enabled. Everything else must
    // authorize inside its own loader/action: a guard in a parent route or in the UI is not enough.
    const PUBLIC = new Set(["home.tsx", "login.tsx", "logout.ts", "api.auth.$.ts", "dev.login.tsx"]);
    const protectedRoutes = appFiles.filter(
      (f) => f.startsWith("app/routes/") && !PUBLIC.has(f.slice("app/routes/".length)),
    );
    assert.ok(protectedRoutes.length >= 2, "expected at least /me and /unclaimed");
    for (const f of protectedRoutes) {
      const src = stripComments(readFileSync(f, "utf8"));
      assert.match(src, /\brequire(Role|AssignedUser|Unassigned|ApiRole)\(/, `${f} has no authorization guard`);
      assert.match(src, /export (async )?function (loader|action)/, `${f} should authorize in a loader or action`);
    }
  });

  it("the dev switcher route checks the enable flag before doing anything", () => {
    const src = stripComments(readFileSync("app/routes/dev.login.tsx", "utf8"));
    const loader = src.slice(src.indexOf("export function loader"), src.indexOf("export async function action"));
    assert.match(loader, /devAuth\.enabled/);
    assert.match(src.slice(src.indexOf("export async function action")), /devAuth\.enabled[\s\S]*?status: 404/);
  });
});
