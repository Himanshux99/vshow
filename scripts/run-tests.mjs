#!/usr/bin/env node
// Test runner built on node:test's programmatic API, so skip/todo/fail decisions come from real
// runner events (not from parsing printed output).
//
//   node scripts/run-tests.mjs                 run tests/**/*.test.ts; skips are reported prominently
//   node scripts/run-tests.mjs --fail-on-skip  CI mode: any skipped or todo test fails the run
//   node scripts/run-tests.mjs [--fail-on-skip] <file>...   run specific files (used by the runner's own tests)
//
// Exit code: 0 = all passed (and no forbidden skips), 1 = a test failed, a skip was forbidden, or no tests ran.
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";

/**
 * Intentional skips that are permitted even with --fail-on-skip: test name -> reason.
 * Keep this empty unless a skip is genuinely unavoidable, and explain why here.
 */
const ALLOWED_SKIPS = new Map();

const args = process.argv.slice(2);
const failOnSkip = args.includes("--fail-on-skip");
const explicit = args.filter((a) => !a.startsWith("--"));

function discover(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? discover(p) : e.name.endsWith(".test.ts") ? [resolve(p)] : [];
  });
}

const files = explicit.length ? explicit.map((f) => resolve(f)) : discover("tests");
if (files.length === 0) {
  console.error("✖ No test files found.");
  process.exit(1);
}

const stream = run({
  files,
  concurrency: true,
  // Applied to each test file's process: load .env if present, hide the type-stripping notice.
  execArgv: ["--env-file-if-exists=.env", "--disable-warning=ExperimentalWarning"],
});

let passed = 0;
let failed = 0;
const skipped = [];
const todo = [];
stream.on("test:pass", (d) => {
  if (d.details?.type === "suite") return;
  if (d.skip !== undefined) skipped.push(d.name);
  else if (d.todo !== undefined) todo.push(d.name);
  else passed++;
});
stream.on("test:fail", () => {
  failed++;
});

for await (const chunk of stream.compose(spec)) process.stdout.write(chunk);

const forbiddenSkips = skipped.filter((n) => !ALLOWED_SKIPS.has(n));
console.log(`\nRunner summary: ${passed} passed, ${failed} failed, ${skipped.length} skipped, ${todo.length} todo`);

let code = 0;
if (failed > 0) {
  console.error("✖ Some tests failed.");
  code = 1;
}
if (passed + skipped.length + todo.length === 0) {
  console.error("✖ No tests ran.");
  code = 1;
}
if (forbiddenSkips.length + todo.length > 0) {
  const names = [...forbiddenSkips, ...todo].map((n) => `  - ${n}`).join("\n");
  if (failOnSkip) {
    console.error(
      `✖ ${forbiddenSkips.length + todo.length} skipped/todo test(s) are not allowed with --fail-on-skip:\n${names}`,
    );
    code = 1;
  } else {
    console.warn(
      `⚠ ${forbiddenSkips.length + todo.length} test(s) were skipped, NOT passed (CI treats this as a failure):\n${names}`,
    );
  }
}
process.exitCode = code;
