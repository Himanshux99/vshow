// Composition root: the one place that reads process.env and decides which concrete infrastructure the
// app uses. Everything else receives `AppDeps` (or a request scope built from it) explicitly, so tests
// can build their own with fakes. Future providers (storage, auth) are added here as plain properties.
import { resolveDbConfig } from "../db/config.server.ts";
import { createDbProvider, type DbProvider } from "../db/client.server.ts";
import { createLogger, resolveLogConfig, type Logger } from "../logging/logger.server.ts";

export interface AppDeps {
  logger: Logger;
  database: DbProvider;
}

type Env = Record<string, string | undefined>;

/** Wires the real implementations. Cheap: no database connection is opened until `database.get()`. */
export function createContainer(env: Env = process.env, isTty = Boolean(process.stdout.isTTY)): AppDeps {
  const logConfig = resolveLogConfig(env, isTty);
  const logger = createLogger({ level: logConfig.level, pretty: logConfig.pretty });
  if (logConfig.invalidLevel) {
    logger.warn("ignoring invalid LOG_LEVEL; using default", { value: logConfig.invalidLevel, level: logConfig.level });
  }
  const database = createDbProvider({ resolveConfig: () => resolveDbConfig(env, "runtime"), logger });
  return { logger, database };
}

// One container per server process. It is cached on globalThis only so dev-mode hot reloads and warm
// serverless invocations do not create a second pool; application code never touches this directly.
const globalForContainer = globalThis as unknown as { __vshowContainer?: AppDeps };

export function getContainer(): AppDeps {
  return (globalForContainer.__vshowContainer ??= createContainer());
}
