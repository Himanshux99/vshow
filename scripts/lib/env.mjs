import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const ENV_FILE = ".env";
export const EXAMPLE_FILE = ".env.example";
export const MIN_NODE = [22, 22, 0];

export function isPlaceholder(value) {
  return value === undefined || value === "" || /^change-?me/i.test(value);
}

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export function readEnvFile(path = ENV_FILE) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// Replace the KEY= line in place (keeps comments/order), or append it.
export function setEnvValue(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, () => `${key}=${value}`);
  return text.replace(/\n*$/, "\n") + `${key}=${value}\n`;
}

// Atomic write; owner-only permissions on POSIX (no-op on Windows).
export function writeEnvFile(text, path = ENV_FILE) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

export function nodeVersionOk(version = process.versions.node) {
  const cur = version.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (cur[i] > MIN_NODE[i]) return true;
    if (cur[i] < MIN_NODE[i]) return false;
  }
  return true;
}

export function run(cmd, args) {
  try {
    return spawnSync(cmd, args, { encoding: "utf8", timeout: 20000 });
  } catch {
    return { status: 1, error: true };
  }
}

export const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// Returns { host, port, db } without ever exposing credentials.
export function describeUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || "5432", db: u.pathname.slice(1) };
  } catch {
    return null;
  }
}
