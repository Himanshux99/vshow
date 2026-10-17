// Seeding safety: a thin wrapper over the shared local-target guard (see local-target.ts).
// Seeding additionally requires an explicit APP_ENV and has no remote opt-in.
import type { DbConfig } from "../../app/db/config.server.ts";
import { TargetGuardError, assertLocalComposeTarget } from "./local-target.ts";

export class SeedGuardError extends Error {
  override name = "SeedGuardError";
}

export function assertSeedAllowed(env: Record<string, string | undefined>, dotenv?: Record<string, string>): DbConfig {
  try {
    return assertLocalComposeTarget(env, { requireAppEnv: true, dotenv });
  } catch (err) {
    if (err instanceof TargetGuardError) throw new SeedGuardError(err.message);
    throw err;
  }
}
