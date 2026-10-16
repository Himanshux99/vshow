// Composition root: the one place that reads process.env and decides which concrete infrastructure (and
// which hosting platform adapter) the app uses. Everything else receives `AppDeps` (or a request scope built
// from it) explicitly, so tests can build their own with fakes. Future providers (storage) are added here
// as plain properties.
import { buildAuth, type AuthProvider } from "../auth/auth.server.ts";
import { resolveAuthConfig, resolveDevAuth, type AuthConfig } from "../auth/config.server.ts";
import { resolveDbConfig } from "../db/config.server.ts";
import { createDbProvider, type DbProvider } from "../db/client.server.ts";
import { assertLocalComposeTarget } from "../db/local-target.server.ts";
import { createLogger, resolveLogConfig, type Logger } from "../logging/logger.server.ts";
import { selectPlatform } from "../platform/platform.server.ts";
import type { ObjectStorage } from "../storage/object-storage.server.ts";
import { createStorage } from "../storage/provider.server.ts";
import { resolveMediaPolicy, type MediaPolicy } from "../submissions/media-policy.server.ts";

export interface AppDeps {
  logger: Logger;
  database: DbProvider;
  auth: AuthProvider;
  /** Media object storage (Neon Object Storage, or the fail-closed provider when not configured). */
  storage: ObjectStorage;
  /** File size, window-count and URL lifetime limits. */
  media: MediaPolicy;
}

type Env = Record<string, string | undefined>;

/**
 * Wires the real implementations. Cheap: no database connection is opened and no auth configuration is
 * validated until first use. The ONE eager check is the dev-switcher guard: if VSHOW_DEV_AUTH is set and any
 * safety condition fails, creating the container throws, so the server refuses to run with an unsafe flag.
 */
export function createContainer(env: Env = process.env, isTty = Boolean(globalThis.process?.stdout?.isTTY)): AppDeps {
  const logConfig = resolveLogConfig(env, isTty);
  const logger = createLogger({ level: logConfig.level, pretty: logConfig.pretty });
  if (logConfig.invalidLevel) {
    logger.warn("ignoring invalid LOG_LEVEL; using default", { value: logConfig.invalidLevel, level: logConfig.level });
  }
  const platform = selectPlatform(env, logger);
  logger.debug("container created", { platform: platform.name });
  const database = createDbProvider({
    resolveConfig: () => resolveDbConfig(env, "runtime"),
    logger,
    // Hosting-specific pool lifecycle (Vercel registers it; Node does nothing). See app/platform/.
    onPoolCreated: platform.onPoolCreated?.bind(platform),
  });

  // Reuses the shared Compose-database guard (also used by db:seed / db:migrate / db:reset:local).
  const devAuth = resolveDevAuth(env, () => {
    assertLocalComposeTarget(env, {});
  });
  if (devAuth.enabled) logger.warn("DEVELOPMENT identity switcher is ENABLED (local development only)");

  let config: AuthConfig | undefined;
  let auth: ReturnType<typeof buildAuth> | undefined;
  const authProvider: AuthProvider = {
    devAuth,
    config() {
      // Without the identity switcher, vauth credentials are mandatory; with it, they may be absent.
      return (config ??= resolveAuthConfig(env, { oauthOptional: devAuth.enabled }));
    },
    get() {
      return (auth ??= buildAuth({ config: authProvider.config(), database, logger, devAuth }));
    },
  };
  const { policy: media, invalid } = resolveMediaPolicy(env);
  if (invalid.length > 0) logger.warn("ignoring invalid media settings; using defaults", { variables: invalid });
  const storage = createStorage(env, logger);
  return { logger, database, auth: authProvider, storage, media };
}

// One container per server process. It is cached on globalThis only so dev-mode hot reloads and warm
// serverless invocations do not create a second pool; application code never touches this directly.
const globalForContainer = globalThis as unknown as { __vshowContainer?: AppDeps };

export function getContainer(): AppDeps {
  return (globalForContainer.__vshowContainer ??= createContainer());
}
