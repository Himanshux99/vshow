// The ONE seam for genuine hosting differences. Today there is a single difference worth abstracting:
// what to do when a database pool is created (Vercel wants it registered so idle connections are closed
// before an instance is suspended; a conventional Node server needs nothing).
//
// Deliberately tiny. Add a method here only when a real runtime difference appears, and put each
// provider's code in its own file under app/platform/. Shared application code (routes, validation, API
// errors, logging, business rules) must never import a provider package; tests/portability.test.ts enforces
// that. Provider detection happens here and nowhere else.
import type { PoolLike } from "../db/client.server.ts";
import type { Logger } from "../logging/logger.server.ts";
import { createVercelAdapter } from "./vercel.server.ts";

export type PlatformName = "vercel" | "node";

export interface PlatformAdapter {
  readonly name: PlatformName;
  /** Called once, right after the application creates its database pool. Optional. */
  onPoolCreated?(pool: PoolLike): void;
}

/** Conventional Node hosting (and local development): no special lifecycle handling is required. */
export const nodePlatform: PlatformAdapter = { name: "node" };

export function detectPlatform(env: Record<string, string | undefined>): PlatformName {
  return env.VERCEL ? "vercel" : "node";
}

export function selectPlatform(env: Record<string, string | undefined>, logger: Logger): PlatformAdapter {
  return detectPlatform(env) === "vercel" ? createVercelAdapter(logger) : nodePlatform;
}
