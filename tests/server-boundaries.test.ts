import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

  it("process.env is read only by the composition root", () => {
    const readers = appFiles.filter((f) => /process\.env/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")));
    assert.deepEqual(readers, ["app/server/container.server.ts"]);
  });

  it("application code uses the logger, not console", () => {
    const offenders = appFiles.filter((f) => /\bconsole\.(log|error|warn|info|debug)\b/.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("no module-level singleton database exists any more", () => {
    assert.ok(!appFiles.some((f) => /\bgetDb\b/.test(readFileSync(f, "utf8"))));
  });

  it("route modules never import the logger library or database driver directly", () => {
    const routes = appFiles.filter((f) => f.startsWith("app/routes/") || f === "app/root.tsx");
    for (const f of routes) {
      assert.ok(!importsOf(f).some((i) => /^(pino|pg|drizzle-orm)/.test(i)), relative(".", f));
    }
  });
});

describe("server-only boundaries (production build)", () => {
  it("keeps Pino, the database driver, env names and request scope code out of the browser bundle", () => {
    const build = spawnSync(process.execPath, ["node_modules/@react-router/dev/bin.cjs", "build"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(build.status, 0, build.stderr.slice(-500) || build.stdout.slice(-500));

    const clientFiles = walk("build/client").filter((f) => /\.(js|mjs|css|html|json|map)$/.test(f));
    assert.ok(clientFiles.length > 0, "client build output expected");
    const forbidden = [
      "pino",
      "node-postgres",
      "drizzle-orm",
      "DATABASE_URL",
      "BETTER_AUTH",
      "x-request-id",
      "createRequestScopeMiddleware",
      "sanitizeString",
    ];
    for (const file of clientFiles) {
      const text = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        assert.ok(!text.includes(needle), `${norm(file)} contains "${needle}"`);
      }
    }

    const serverFiles = walk("build/server").filter((f) => f.endsWith(".js"));
    assert.ok(
      serverFiles.some((f) => readFileSync(f, "utf8").includes("request completed")),
      "the server build should contain the request logging middleware",
    );
  });
});
