// Removes secrets and personal data from anything that is about to be logged.
// Pure and dependency-free so it is easy to test. Server-only (never imported by client code).
//
// Strategy (defence in depth, applied to every structured field AND every message):
//  1. Values under sensitive KEY names (password, token, cookie, authorization, session, ...) are replaced.
//  2. Strings are scanned for credential-shaped content (connection strings, bearer tokens, JWTs,
//     cloud keys, presigned-URL signatures, emails) wherever they appear.
//  3. Binary data and request/upload bodies are never logged, only a placeholder.
//  4. Unknown class instances are summarised, not walked, so they cannot leak internal state.

export const REDACTED = "[REDACTED]";
export const OMITTED = "[OMITTED]";

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 2000;

/** Keys whose values are credentials or session material. */
const SECRET_KEY =
  /pass(word|wd|phrase)?|secret|token|authori[sz]ation|cookie|api[-_]?key|private[-_]?key|signing|signature|credential|session|connection[-_]?string|database[-_]?url|\bdsn\b|csrf|jwt|bearer|x-amz-|auth(orization)?[-_]?code|code[-_]?(verifier|challenge)|verifier|nonce|^state$|^oauth/i;
/** Keys that hold personal data or whole request/upload payloads: omitted by default. */
const PRIVATE_KEY =
  /^(e-?mail|phone|mobile|address|ip|ip[-_]?address|remote[-_]?addr(ess)?|user[-_]?agent|full[-_]?name|first[-_]?name|last[-_]?name|body|raw[-_]?body|request[-_]?body|form[-_]?data|multipart|file|files|buffer|bytes|chunk)$/i;

const URL_WITH_DB_SCHEME = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s'"<>]+/gi;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"<>]+:[^\s/@'"<>]*@/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const AWS_ACCESS_KEY = /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g;
// Neon storage credentials: access key ids (nak_...) and secrets (nsk_...).
const NEON_STORAGE_KEY = /\bn[as]k_[A-Za-z]+_[A-Za-z0-9_-]{8,}/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const SIGNED_QUERY =
  /\b(X-Amz-(?:Signature|Credential|Security-Token)|Signature|sig|access_token|id_token|refresh_token)=[^&\s'"]+/gi;
// OAuth authorization-response parameters. Anchored to a query-string separator so ordinary prose such as
// "status code=200" is left alone.
const OAUTH_QUERY = /([?&])(code|state|code_verifier|error_description)=[^&\s'"#]+/gi;
const KEY_VALUE =
  /\b(password|passwd|pwd|secret|token|api[-_]?key|authorization|cookie|set-cookie|session[-_]?id)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

/** Scrubs credential-shaped content and emails out of free text. */
export function sanitizeString(input: string): string {
  let s =
    input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…[truncated ${input.length - MAX_STRING} chars]` : input;
  s = s.replace(PRIVATE_KEY_BLOCK, "[REDACTED PRIVATE KEY]");
  s = s.replace(URL_WITH_DB_SCHEME, "[REDACTED_URL]");
  s = s.replace(URL_CREDENTIALS, "$1[REDACTED]@");
  s = s.replace(BEARER, "$1 [REDACTED]");
  s = s.replace(JWT, "[REDACTED_JWT]");
  s = s.replace(AWS_ACCESS_KEY, "[REDACTED_KEY]");
  s = s.replace(NEON_STORAGE_KEY, "[REDACTED_KEY]");
  s = s.replace(SIGNED_QUERY, "$1=[REDACTED]");
  s = s.replace(OAUTH_QUERY, "$1$2=[REDACTED]");
  s = s.replace(KEY_VALUE, "$1=[REDACTED]");
  s = s.replace(EMAIL, "[EMAIL]");
  return s;
}

export interface SerializedError {
  type: string;
  message: string;
  stack?: string;
  code?: string | number;
  /** PostgreSQL constraint/table names are useful and safe; `detail` (which contains row values) is never copied. */
  constraint?: string;
  table?: string;
  cause?: SerializedError | string;
}

/** Turns any thrown value into a safe, structured object. Never copies arbitrary properties. */
export function serializeError(err: unknown, depth = 0): SerializedError {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown; constraint?: unknown; table?: unknown; cause?: unknown };
    const out: SerializedError = {
      type: sanitizeString(String(e.name || "Error")),
      message: sanitizeString(String(e.message ?? "")),
    };
    if (e.stack) out.stack = sanitizeString(e.stack);
    if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
    if (typeof e.constraint === "string") out.constraint = e.constraint;
    if (typeof e.table === "string") out.table = e.table;
    if (e.cause !== undefined) out.cause = depth >= 3 ? "[max cause depth]" : serializeError(e.cause, depth + 1);
    return out;
  }
  // Not an Error (string, number, plain object, Response...): keep only a safe description.
  return { type: "NonError", message: sanitizeString(typeof err === "string" ? err : describeValue(err)) };
}

function describeValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") return `[${(v as object).constructor?.name ?? "Object"}]`;
  return String(v);
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Deeply sanitizes a value for logging. Safe on cycles, binary data and hostile objects. */
export function sanitize(value: unknown, key?: string, depth = 0, seen = new WeakSet<object>()): unknown {
  if (key !== undefined) {
    if (SECRET_KEY.test(key)) return REDACTED;
    if (PRIVATE_KEY.test(key)) return OMITTED;
  }
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "string":
      return sanitizeString(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "symbol":
    case "function":
      return `[${typeof value}]`;
  }

  const obj = value as object;
  if (obj instanceof Error) return serializeError(obj);
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? "[Invalid Date]" : obj.toISOString();
  if (obj instanceof URL) return sanitizeString(`${obj.origin}${obj.pathname}`); // no query string or fragment
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return `${OMITTED} binary`;
  if (typeof Blob !== "undefined" && obj instanceof Blob) return `${OMITTED} blob`;
  if (typeof Request !== "undefined" && obj instanceof Request) {
    return { method: obj.method, path: new URL(obj.url).pathname };
  }
  if (typeof Response !== "undefined" && obj instanceof Response) return { status: obj.status };
  if (typeof Headers !== "undefined" && obj instanceof Headers) {
    return sanitize(Object.fromEntries(obj.entries()), undefined, depth, seen);
  }

  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[max depth]";
  seen.add(obj);

  if (Array.isArray(obj)) {
    const items = obj.slice(0, MAX_ARRAY).map((v) => sanitize(v, undefined, depth + 1, seen));
    if (obj.length > MAX_ARRAY) items.push(`[+${obj.length - MAX_ARRAY} more]`);
    return items;
  }
  if (obj instanceof Map || obj instanceof Set) return `[${obj.constructor.name} size=${obj.size}]`;
  if (!isPlainObject(obj)) return `[${obj.constructor?.name ?? "Object"}]`;

  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    let v: unknown;
    try {
      v = (obj as Record<string, unknown>)[k];
    } catch {
      v = "[unreadable]";
    }
    out[k] = sanitize(v, k, depth + 1, seen);
  }
  return out;
}

/** Sanitizes the top-level field bag of a log record (the `err` key is handled by serializeError). */
export function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) {
    out[k] = k === "err" || k === "error" ? serializeError(fields[k]) : sanitize(fields[k], k);
  }
  return out;
}
