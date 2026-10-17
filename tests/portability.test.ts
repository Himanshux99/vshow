import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const norm = (p: string) => p.split("\\").join("/");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (f: string) => readFileSync(f, "utf8");
const code = (f: string) => stripComments(read(f));
const appFiles = walk("app")
  .map(norm)
  .filter((f) => /\.(ts|tsx)$/.test(f));
const importsOf = (f: string) => [...code(f).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

const PROVIDER_PACKAGE =
  /^(@vercel\/|@cloudflare\/|cloudflare:|wrangler|@react-router\/cloudflare|@netlify\/|@aws-sdk\/client-lambda)/;
const NODE_ONLY_IMPORT = /^(node:|@react-router\/node$|pg$|pino$)/;
const VERCEL_FILE = "app/platform/vercel.server.ts";

describe("provider isolation: shared code never imports a hosting provider", () => {
  it("only app/platform/ files may import any provider package", () => {
    const offenders = appFiles.filter(
      (f) => !f.startsWith("app/platform/") && importsOf(f).some((i) => PROVIDER_PACKAGE.test(i)),
    );
    assert.deepEqual(offenders, []);
  });

  it("`@vercel/*` is referenced by exactly one file, the Vercel adapter", () => {
    const places = [...appFiles, ...walk("scripts").map(norm), "vite.config.ts", "react-router.config.ts"].filter((f) =>
      /@vercel\//.test(read(f)),
    );
    assert.deepEqual(places, [VERCEL_FILE]);
  });

  it("the VERCEL variables are read only by platform selection and by security guards that refuse to run on Vercel", () => {
    const readers = appFiles.filter((f) => /\bVERCEL(_[A-Z]+)?\b/.test(code(f)));
    assert.deepEqual(readers, [
      "app/auth/config.server.ts", // dev-switcher guard + production-environment origin check: refuse, never enable
      "app/db/local-target.server.ts", // shared local-database guard: refuses on Vercel
      "app/platform/platform.server.ts",
    ]);
  });

  it("the vendor package is loaded lazily, never via a static import", () => {
    const src = code(VERCEL_FILE);
    assert.ok(!/^\s*import\s[^;]*["']@vercel\//m.test(src), "a static import would load the package on every host");
    assert.match(src, /await import\(["']@vercel\/functions\/db-connections["']\)/);
  });

  it("routes, schema and the root route import no provider package", () => {
    const shared = appFiles.filter(
      (f) => f.startsWith("app/routes/") || f.startsWith("app/db/schema/") || f === "app/root.tsx",
    );
    for (const f of shared) assert.ok(!importsOf(f).some((i) => PROVIDER_PACKAGE.test(i)), f);
  });
});

describe("runtime portability: what is Web-standard and what is Node-specific", () => {
  // Modules that use only Web-standard APIs, so they can run on Node, Vercel or Cloudflare unchanged.
  const WEB_STANDARD = [
    "app/server/api-response.server.ts",
    "app/server/validation.server.ts",
    "app/server/request-scope.server.ts",
    "app/server/instrumentation.server.ts",
    "app/server/entry-hooks.server.ts",
    "app/logging/sanitize.server.ts",
    "app/db/config.server.ts",
    "app/auth/config.server.ts",
    "app/auth/route-policy.server.ts",
    "app/auth/vauth.server.ts",
    "app/platform/platform.server.ts",
    "app/platform/vercel.server.ts",
  ];

  for (const f of WEB_STANDARD) {
    it(`${f} uses no Node built-ins or Node globals`, () => {
      const src = code(f);
      assert.ok(!importsOf(f).some((i) => NODE_ONLY_IMPORT.test(i)), "Node-only import");
      assert.ok(!/\b(process|Buffer|__dirname|__filename)\b|\brequire\(/.test(src), "Node-only global");
    });
  }

  it("Node-specific code is confined to a documented allow-list", () => {
    const nodeOnly = appFiles.filter(
      (f) =>
        importsOf(f).some((i) => NODE_ONLY_IMPORT.test(i)) || /\bprocess\.(stdout|stderr|versions|cwd)\b/.test(code(f)),
    );
    assert.deepEqual(nodeOnly, [
      "app/db/client.server.ts", // `pg` TCP driver: needs a different driver/connection strategy on Cloudflare
      "app/entry.server.tsx", // Node stream rendering: Cloudflare uses Web-stream rendering
      "app/logging/logger.server.ts", // Pino + process.stdout: swap the backend behind the Logger interface
    ]);
  });
});
