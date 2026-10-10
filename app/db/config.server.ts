// Resolves and validates database connection settings from environment variables.
// Pure and dependency-free (Node can run it directly), and it never includes a
// connection string or password in a thrown message.

export type DbTarget = "local" | "neon";
export type DbPurpose = "runtime" | "migration";

export interface DbConfig {
  /** Full connection string. Treat as a secret: never log it. */
  url: string;
  host: string;
  port: string;
  database: string;
  /** undefined when DB_TARGET is unset (only allowed for runtime use). */
  target: DbTarget | undefined;
  isLocal: boolean;
  isPooler: boolean;
}

export class DbConfigError extends Error {
  override name = "DbConfigError";
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

export function resolveDbConfig(
  env: Record<string, string | undefined>,
  purpose: DbPurpose,
): DbConfig {
  const rawTarget = env.DB_TARGET?.trim() || undefined;
  if (rawTarget !== undefined && rawTarget !== "local" && rawTarget !== "neon") {
    throw new DbConfigError("DB_TARGET must be 'local' or 'neon'.");
  }
  const target = rawTarget as DbTarget | undefined;
  if (purpose === "migration" && !target) {
    throw new DbConfigError("DB_TARGET is not set. Set it to 'local' or 'neon' explicitly before running migrations.");
  }

  const useDirect = purpose === "migration" && Boolean(env.DATABASE_URL_DIRECT?.trim());
  const varName = useDirect ? "DATABASE_URL_DIRECT" : "DATABASE_URL";
  const url = (useDirect ? env.DATABASE_URL_DIRECT : env.DATABASE_URL)?.trim();
  if (!url) {
    throw new DbConfigError(`${varName} is not set. Run \`npm run setup\` or see the README.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DbConfigError(`${varName} is not a valid URL (expected postgresql://user:pass@host:port/db).`);
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new DbConfigError(`${varName} must start with postgresql:// or postgres://.`);
  }
  const host = parsed.hostname;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!host) throw new DbConfigError(`${varName} has no host.`);
  if (!database) throw new DbConfigError(`${varName} has no database name.`);
  if (!parsed.username) throw new DbConfigError(`${varName} has no user name.`);

  const isLocal = isLocalHost(host);
  const isPooler = host.includes("-pooler");

  if (target === "local" && !isLocal) {
    throw new DbConfigError(`DB_TARGET=local but ${varName} points at '${host}', which is not a loopback host.`);
  }
  if (target === "neon") {
    if (isLocal || !host.endsWith(".neon.tech")) {
      throw new DbConfigError(`DB_TARGET=neon but ${varName} host '${host}' is not a *.neon.tech host.`);
    }
    const sslmode = parsed.searchParams.get("sslmode");
    if (sslmode !== "require" && sslmode !== "verify-full" && sslmode !== "verify-ca") {
      throw new DbConfigError(`${varName} must include sslmode=require for Neon.`);
    }
  }
  if (purpose === "migration" && isPooler) {
    throw new DbConfigError(
      "Migrations need a direct (non-pooled) connection, but the URL host is a Neon pooler. " +
        "Set DATABASE_URL_DIRECT to the direct connection string.",
    );
  }

  return { url, host, port: parsed.port || "5432", database, target, isLocal, isPooler };
}

/** Removes the connection string and its password from text before it is displayed. */
export function redact(text: string, url?: string): string {
  let out = text;
  if (url) {
    out = out.split(url).join("[redacted-url]");
    try {
      const pw = decodeURIComponent(new URL(url).password);
      if (pw) out = out.split(pw).join("[redacted]");
    } catch {
      /* unparsable URL: nothing more to redact */
    }
  }
  return out.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[redacted-url]");
}
