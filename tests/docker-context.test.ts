import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 90_000 }).status === 0;

// Builds a throwaway image from the repo directory and lists exactly what the Docker build context
// contains after .dockerignore is applied. The Dockerfile comes from stdin, so nothing is written to the repo
// except two sentinel files that are removed afterwards.
describe("docker build context", () => {
  it(
    "excludes env files, VCS data, dependencies and dev-only directories",
    { skip: !hasDocker && "docker unavailable" },
    () => {
      const sentinels = [".env.docker-test-sentinel", "docker-test-secret.pem"];
      sentinels.forEach((f) => writeFileSync(f, "synthetic-not-a-secret\n"));
      try {
        const dockerfile =
          "FROM alpine:3.20\nCOPY . /ctx\nRUN find /ctx -mindepth 1 -maxdepth 2 | sort | sed 's#^/ctx/##' | sed 's#^#CTX:#'\n";
        const r = spawnSync("docker", ["build", "--no-cache", "--progress=plain", "-f", "-", "."], {
          input: dockerfile,
          encoding: "utf8",
          timeout: 180_000,
        });
        assert.equal(r.status, 0, r.stderr.slice(-500));
        const files = new Set(
          (r.stdout + r.stderr)
            .split(/\r?\n/)
            .map((l) => l.match(/CTX:(.+)$/)?.[1]?.trim())
            .filter((x): x is string => Boolean(x)),
        );
        assert.ok(files.has("package.json") && files.has("app/root.tsx"), "build inputs must be present");
        assert.ok(files.has(".env.example"), "placeholder file is allowed");
        const forbidden =
          /^(\.env(\..*)?|.*\.pem|.*\.key|\.git(\/.*)?|\.github|node_modules|docs|tests|scripts|drizzle|\.claude|\.agents|build|\.react-router)$/;
        const leaked = [...files].filter((f) => forbidden.test(f) && f !== ".env.example");
        assert.deepEqual(leaked, [], "these paths must not be sent to the Docker daemon");
      } finally {
        sentinels.forEach((f) => rmSync(f, { force: true }));
      }
    },
  );
});
