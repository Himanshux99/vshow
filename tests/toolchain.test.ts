import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(p, "utf8");
const pkg = JSON.parse(read("package.json"));
const major = read(".nvmrc").trim();

describe("toolchain policy: one Node major, one pinned npm", () => {
  it(".nvmrc is a bare major version", () => {
    assert.match(major, /^\d+$/);
  });

  it("package.json engines targets exactly that major", () => {
    assert.equal(pkg.engines.node, `${major}.x`);
  });

  it("packageManager pins an exact npm version", () => {
    assert.match(pkg.packageManager, /^npm@\d+\.\d+\.\d+$/);
  });

  it("Dockerfile uses the same Node major and npm version", () => {
    const docker = read("Dockerfile");
    const froms = [...docker.matchAll(/^FROM node:(\d+)[\w.-]* /gm)].map((m) => m[1]);
    assert.ok(froms.length > 0);
    assert.ok(
      froms.every((m) => m === major),
      `Dockerfile FROM node:${froms} must be ${major}`,
    );
    assert.equal(docker.match(/^ARG NPM_VERSION=(\S+)/m)?.[1], pkg.packageManager.split("@")[1]);
  });

  it("every CI Node setup reads .nvmrc and pins npm", () => {
    const ci = read(".github/workflows/ci.yml");
    const setups = ci.match(/actions\/setup-node@/g)?.length ?? 0;
    assert.ok(setups > 0);
    assert.equal(ci.match(/node-version-file: \.nvmrc/g)?.length ?? 0, setups);
    assert.doesNotMatch(ci, /node-version:\s/);
    assert.equal(ci.match(/Pin npm to the version in package\.json/g)?.length ?? 0, setups);
  });

  it("the running toolchain matches the policy", () => {
    assert.equal(process.versions.node.split(".")[0], major, `run with Node ${major}.x (see .nvmrc)`);
    const npm = process.env.npm_config_user_agent?.match(/^npm\/(\d+\.\d+\.\d+)/)?.[1];
    if (npm) assert.equal(npm, pkg.packageManager.split("@")[1], "npm differs from package.json packageManager");
  });
});
