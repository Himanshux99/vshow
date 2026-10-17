// Vshow's logging abstraction. This is the ONLY module that imports Pino; the rest of the app depends
// on the small `Logger` interface below, so the backend can change without touching callers.
// Server-only: the `.server` suffix makes the bundler refuse any client import of this file.
import { pino } from "pino";
import { sanitizeFields, sanitizeString } from "./sanitize.server.ts";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Structured fields. Pass thrown values as `{ err }` so they are serialized safely. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
  /** A logger that adds `bindings` (e.g. `{ requestId }`) to every record. */
  child(bindings: LogFields): Logger;
}

export interface LogConfig {
  level: LogLevel;
  /** Human-readable output for local development; JSON otherwise. */
  pretty: boolean;
  /** Set when LOG_LEVEL was present but invalid, so the caller can mention it. */
  invalidLevel?: string;
}

type Env = Record<string, string | undefined>;

/**
 * LOG_LEVEL: trace|debug|info|warn|error|fatal|silent (invalid values fall back to the default).
 * Default level: debug in development, info otherwise (production-safe).
 * LOG_FORMAT: "json" | "pretty". Default: pretty only for an interactive non-production terminal.
 */
export function resolveLogConfig(env: Env, isTty = false): LogConfig {
  const production = env.NODE_ENV === "production";
  const requested = env.LOG_LEVEL?.trim().toLowerCase();
  const valid = requested && (LOG_LEVELS as readonly string[]).includes(requested);
  const level = valid ? (requested as LogLevel) : production || env.APP_ENV === "test" ? "info" : "debug";
  const format = env.LOG_FORMAT?.trim().toLowerCase();
  const pretty = format === "pretty" ? true : format === "json" ? false : !production && isTty;
  return { level, pretty, ...(requested && !valid ? { invalidLevel: sanitizeString(requested).slice(0, 40) } : {}) };
}

export interface Destination {
  write(line: string): unknown;
}

export interface CreateLoggerOptions {
  level?: LogLevel;
  /** Where JSON lines go. Defaults to stdout (or the pretty formatter). Tests pass a capturing sink. */
  destination?: Destination;
  pretty?: boolean;
  bindings?: LogFields;
}

const LEVEL_COLOR: Record<string, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
};

/** Dependency-free development formatter: `12:00:00.000 INFO  message {"field":1}`. */
export function createPrettyDestination(
  write: (text: string) => unknown = (t) => process.stdout.write(t),
): Destination {
  return {
    write(line: string) {
      try {
        const { level, time, msg, service: _service, ...rest } = JSON.parse(line) as Record<string, unknown>;
        const label = String(level ?? "info");
        const clock = typeof time === "string" ? time.slice(11, 23) : "";
        const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
        write(
          `${clock} ${LEVEL_COLOR[label] ?? ""}${label.toUpperCase().padEnd(5)}\x1b[0m ${String(msg ?? "")}${extra}\n`,
        );
      } catch {
        write(line); // never lose a record because formatting failed
      }
    },
  };
}

function wrap(base: pino.Logger): Logger {
  // Pino signature is (fields, message); ours is (message, fields) to read naturally at call sites.
  const at =
    (level: "trace" | "debug" | "info" | "warn" | "error" | "fatal") => (message: string, fields?: LogFields) =>
      base[level](fields ?? {}, message);
  return {
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    fatal: at("fatal"),
    child: (bindings) => wrap(base.child(sanitizeFields(bindings))),
  };
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const destination = options.destination ?? (options.pretty ? createPrettyDestination() : undefined);
  const instance = pino(
    {
      level: options.level ?? "info",
      base: { service: "vshow" },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Errors are already serialized (and scrubbed) by sanitizeFields; don't let Pino re-process them.
      serializers: { err: (value: unknown) => value },
      formatters: {
        level: (label) => ({ level: label }),
        // Runs on every record's structured fields, whoever the caller is.
        log: (fields) => sanitizeFields(fields),
      },
      hooks: {
        // Messages are free text and can carry secrets (e.g. an interpolated URL): scrub them too.
        logMethod(args, method) {
          const i = typeof args[0] === "string" ? 0 : 1;
          if (typeof args[i] === "string") args[i] = sanitizeString(args[i] as string);
          return method.apply(this, args);
        },
      },
      // Last-resort net for the usual suspects if someone logs a raw object under these exact paths.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
          "headers.authorization",
          "headers.cookie",
          "*.password",
          "*.token",
        ],
        censor: "[REDACTED]",
      },
    },
    destination as pino.DestinationStream | undefined,
  );
  const root = wrap(options.bindings ? instance.child(sanitizeFields(options.bindings)) : instance);
  return root;
}

/** A logger that discards everything (for tests and for code paths that must stay silent). */
export function createNoopLogger(): Logger {
  const noop = () => {};
  const logger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger;
}
