// Vercel-specific behaviour. This is the ONLY file allowed to reference `@vercel/*`.
//
// On Vercel (Fluid compute) one function instance serves many requests and is later suspended. Vercel's
// `attachDatabasePool` keeps the instance alive just long enough for idle pool connections to be closed, so
// Neon is not left holding connections from frozen instances. Vercel marks that API experimental.
//
// The package is loaded with a dynamic import so it is never evaluated on any other host, and a failure to
// load or call it only logs a warning: it is an optimisation of connection cleanup, never a correctness
// requirement. To drop Vercel support entirely: delete this file, its branch in platform.server.ts, and the
// `@vercel/functions` dependency.
import type { PoolLike } from "../db/client.server.ts";
import type { Logger } from "../logging/logger.server.ts";
import type { PlatformAdapter } from "./platform.server.ts";

type AttachPool = (pool: PoolLike) => void;

export interface VercelAdapterOptions {
  /** Test seam: resolves the vendor function. Defaults to a dynamic import of `@vercel/functions`. */
  loadAttach?: () => Promise<AttachPool>;
}

async function loadVendorAttach(): Promise<AttachPool> {
  const { attachDatabasePool } = await import("@vercel/functions/db-connections");
  // The vendor type describes a real pg.Pool; at runtime we pass exactly that.
  return attachDatabasePool as unknown as AttachPool;
}

export function createVercelAdapter(
  logger: Logger,
  { loadAttach = loadVendorAttach }: VercelAdapterOptions = {},
): PlatformAdapter {
  return {
    name: "vercel",
    onPoolCreated(pool) {
      loadAttach()
        .then((attach) => attach(pool))
        .catch((err: unknown) => logger.warn("could not register the database pool with Vercel", { err }));
    },
  };
}
