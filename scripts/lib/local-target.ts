// Script-side entry for the shared local-target guard. The guard itself lives in app/db/local-target.server.ts
// (pure, no file access) so the application can reuse it; only the .env reader, which needs the filesystem,
// stays here.
import { existsSync, readFileSync } from "node:fs";

export { TargetGuardError, assertLocalComposeTarget, type GuardOptions } from "../../app/db/local-target.server.ts";

/** Parses KEY=VALUE lines. Path defaults to VSHOW_ENV_FILE or .env; missing/empty path => no values. */
export function loadDotenv(path: string | undefined = process.env.VSHOW_ENV_FILE ?? ".env"): Record<string, string> {
  if (!path || !existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
