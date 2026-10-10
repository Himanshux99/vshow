import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

// Controlled fixtures run through the real runner (scripts/run-tests.mjs) to prove that failures and
// skips produce the exit codes CI relies on.
const dir = mkdtempSync(join(tmpdir(), "vshow-runner-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const fixture = (name: string, body: string) => {
  const file = join(dir, `${name}.test.mjs`);
  writeFileSync(file, `import { test, describe, it } from "node:test";\n${body}\n`);
  return file;
};
const files = {
  pass: fixture("pass", `test("ok", () => {});`),
  fail: fixture("fail", `test("boom", () => { throw new Error("intentional"); });`),
  skipStatic: fixture("skip-static", `test("a", () => {}); test("needs db", { skip: "no db" }, () => {});`),
  skipDynamic: fixture("skip-dynamic", `test("dyn", (t) => { t.skip("runtime"); });`),
  skipNested: fixture(
    "skip-nested",
    `describe("s", () => { it("inner", { skip: true }, () => {}); it("ok", () => {}); });`,
  ),
  todo: fixture("todo", `test("later", { todo: true }, () => {});`),
};

// node:test refuses to start a nested run() when it inherits NODE_TEST_CONTEXT from the outer runner.
const { NODE_TEST_CONTEXT: _outer, ...cleanEnv } = process.env;
const runner = (args: string[]) =>
  spawnSync(process.execPath, ["scripts/run-tests.mjs", ...args], { encoding: "utf8", timeout: 60_000, env: cleanEnv });

describe("test runner exit codes", () => {
  it("passes when everything passes, in both modes", () => {
    assert.equal(runner([files.pass]).status, 0);
    assert.equal(runner(["--fail-on-skip", files.pass]).status, 0);
  });

  it("fails when a test fails, in both modes", () => {
    const r = runner([files.fail]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Some tests failed/);
    assert.equal(runner(["--fail-on-skip", files.fail]).status, 1);
  });

  for (const [name, file] of [
    ["static skip", files.skipStatic],
    ["runtime t.skip()", files.skipDynamic],
    ["nested skip", files.skipNested],
  ] as const) {
    it(`reports a ${name} loudly but passes without --fail-on-skip`, () => {
      const r = runner([file]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /skipped, NOT passed/);
    });

    it(`fails a ${name} with --fail-on-skip`, () => {
      const r = runner(["--fail-on-skip", file]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /not allowed with --fail-on-skip/);
    });
  }

  it("treats todo tests like skips in CI mode", () => {
    assert.equal(runner(["--fail-on-skip", files.todo]).status, 1);
    assert.equal(runner([files.todo]).status, 0);
  });

  it("fails when a test file is missing or cannot be loaded", () => {
    assert.equal(runner([join(dir, "does-not-exist.test.mjs")]).status, 1);
  });
});
