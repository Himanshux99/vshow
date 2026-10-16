// Neon Object Storage configuration. Read from the environment only; nothing is hard-coded or invented.
// The credentials are Neon storage credentials (access key id / secret created with `neon credentials create`),
// NEVER the PostgreSQL connection string. None of these values may reach logs, responses or the client bundle.
type Env = Record<string, string | undefined>;

export class StorageConfigError extends Error {
  override name = "StorageConfigError";
}

export interface NeonStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const STORAGE_ENV = {
  endpoint: "NEON_STORAGE_ENDPOINT",
  region: "NEON_STORAGE_REGION",
  bucket: "NEON_STORAGE_BUCKET",
  accessKeyId: "NEON_STORAGE_ACCESS_KEY_ID",
  secretAccessKey: "NEON_STORAGE_SECRET_ACCESS_KEY",
} as const;

const PLACEHOLDER = /change-me|changeme|your[-_ ]|placeholder|<.*>/i;

/**
 * Returns the configuration, or null when NO storage variable is set at all (storage simply is not configured).
 * A partially set or malformed configuration throws StorageConfigError naming only the VARIABLE, never its value.
 */
export function resolveStorageConfig(env: Env): NeonStorageConfig | null {
  const names = Object.values(STORAGE_ENV);
  if (names.every((n) => !env[n]?.trim())) return null;
  for (const n of names) {
    const v = env[n]?.trim();
    if (!v) throw new StorageConfigError(`${n} is not set.`);
    if (PLACEHOLDER.test(v)) throw new StorageConfigError(`${n} still has a placeholder value.`);
  }
  let url: URL;
  try {
    url = new URL(env[STORAGE_ENV.endpoint]!.trim());
  } catch {
    throw new StorageConfigError(`${STORAGE_ENV.endpoint} is not a valid URL.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new StorageConfigError(`${STORAGE_ENV.endpoint} must be an https URL.`);
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new StorageConfigError(`${STORAGE_ENV.endpoint} must be an origin only (no path, query, or credentials).`);
  }
  const region = env[STORAGE_ENV.region]!.trim();
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) throw new StorageConfigError(`${STORAGE_ENV.region} is malformed.`);
  const bucket = env[STORAGE_ENV.bucket]!.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new StorageConfigError(`${STORAGE_ENV.bucket} is malformed.`);
  }
  const accessKeyId = env[STORAGE_ENV.accessKeyId]!.trim();
  const secretAccessKey = env[STORAGE_ENV.secretAccessKey]!.trim();
  if (/^postgres/i.test(accessKeyId) || /^postgres/i.test(secretAccessKey)) {
    throw new StorageConfigError("Storage credentials must be Neon storage credentials, not a database URL.");
  }
  if (/\s/.test(accessKeyId) || /\s/.test(secretAccessKey)) {
    throw new StorageConfigError("Storage credentials are malformed.");
  }
  return { endpoint: url.origin, region, bucket, accessKeyId, secretAccessKey };
}
