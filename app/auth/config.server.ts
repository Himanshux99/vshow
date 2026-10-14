// Authentication configuration: environment validation, the vauth contract, and the pure rules about which
// identities are acceptable. No I/O and no Better Auth import, so every rule is unit-testable.
// Secrets never appear in error messages.

/** The vauth contract (docs: vauth INTEGRATING.md). Pinned: production must talk to exactly this issuer. */
export const VAUTH = {
  issuer: "https://accounts.vosslabs.org/api/auth",
  discoveryUrl: "https://accounts.vosslabs.org/api/auth/.well-known/openid-configuration",
  providerId: "voss",
  scopes: ["openid", "profile", "email"],
  /** vauth signs ID tokens with EdDSA; any other algorithm is rejected. */
  idTokenAlgorithms: ["EdDSA"],
} as const;

export const PRODUCTION_ORIGIN = "https://vshow.vosslabs.org";

/** Better Auth cookie prefix (cookies are named `vshow.session_token`, `__Secure-vshow.session_token`, ...). */
export const COOKIE_PREFIX = "vshow";

/** Email domains allowed to sign in (exact match, never a suffix match). */
export const ALLOWED_EMAIL_DOMAINS = ["vit.edu.in", "vosslabs.org"] as const;

export const SESSION_POLICY = {
  /** Seconds. A session lasts 7 days from its last refresh... */
  expiresIn: 60 * 60 * 24 * 7,
  /** ...refreshed at most once a day... */
  updateAge: 60 * 60 * 24,
  /** ...and never beyond 30 days from creation (also enforced by a database trigger). */
  absoluteMaxAge: 60 * 60 * 24 * 30,
} as const;

export const SEED_EMAIL_DOMAIN = "seed.vshow.invalid";

type Env = Record<string, string | undefined>;

export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  baseURL: string;
  secret: string;
  discoveryUrl: string;
  /** Issuer derived from the discovery URL. Equals VAUTH.issuer in production. */
  issuer: string;
  /**
   * The registered vauth client. `null` ONLY when `oauthOptional` was granted (local development with the
   * identity switcher, before Vshow is registered with vauth): the vauth provider is then not registered at all.
   */
  oauth: OAuthClientConfig | null;
  /** True when cookies must carry the Secure flag (https origin). */
  secureCookies: boolean;
  production: boolean;
}

const PLACEHOLDER = /^(change-?me|todo|xxx+|placeholder|secret|password)$/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new AuthConfigError(`${name} is not set.`);
  if (PLACEHOLDER.test(value)) throw new AuthConfigError(`${name} still has a placeholder value.`);
  return value;
}

function parseOrigin(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthConfigError(`${name} is not a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AuthConfigError(`${name} must be an http(s) URL.`);
  }
  return url;
}

/** `https://host` or `http://localhost:5173`: an origin only, with no path, query, fragment or credentials. */
function assertPlainOrigin(url: URL, name: string) {
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.href.endsWith("//")) {
    throw new AuthConfigError(`${name} must be an origin only (no path, query, fragment or credentials).`);
  }
}

export function isProductionRuntime(env: Env): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Validates everything Better Auth needs. Production rules (NODE_ENV=production):
 *  - BETTER_AUTH_URL must be https and not localhost; for the real production environment
 *    (VERCEL_ENV or APP_ENV equal to "production") it must be exactly https://vshow.vosslabs.org;
 *  - VOSS_DISCOVERY_URL must be exactly the pinned vauth discovery URL.
 * Outside production, localhost http is allowed so a mock identity provider can be used in tests.
 */
export interface ResolveAuthConfigOptions {
  /** Let VOSS_CLIENT_ID / VOSS_CLIENT_SECRET be absent. Granted only when the dev switcher is enabled. */
  oauthOptional?: boolean;
}

export function resolveAuthConfig(env: Env, { oauthOptional = false }: ResolveAuthConfigOptions = {}): AuthConfig {
  const production = isProductionRuntime(env);

  const secret = required(env, "BETTER_AUTH_SECRET");
  if (secret.length < 32) throw new AuthConfigError("BETTER_AUTH_SECRET must be at least 32 characters.");

  const base = parseOrigin(required(env, "BETTER_AUTH_URL"), "BETTER_AUTH_URL");
  assertPlainOrigin(base, "BETTER_AUTH_URL");
  const baseIsLocal = LOCAL_HOSTS.has(base.hostname);
  if (production) {
    if (base.protocol !== "https:") throw new AuthConfigError("BETTER_AUTH_URL must use https in production.");
    if (baseIsLocal) throw new AuthConfigError("BETTER_AUTH_URL must not be localhost in production.");
  } else if (base.protocol === "http:" && !baseIsLocal) {
    throw new AuthConfigError("BETTER_AUTH_URL may use http only for localhost.");
  }
  const realProduction = env.VERCEL_ENV === "production" || env.APP_ENV === "production";
  if (realProduction && base.origin !== PRODUCTION_ORIGIN) {
    throw new AuthConfigError(`BETTER_AUTH_URL must be exactly ${PRODUCTION_ORIGIN} in the production environment.`);
  }

  const discovery = parseOrigin(required(env, "VOSS_DISCOVERY_URL"), "VOSS_DISCOVERY_URL");
  const discoveryUrl = discovery.href;
  if (production && discoveryUrl !== VAUTH.discoveryUrl) {
    throw new AuthConfigError("VOSS_DISCOVERY_URL must be the pinned vauth discovery URL in production.");
  }
  if (discovery.protocol === "http:" && !LOCAL_HOSTS.has(discovery.hostname)) {
    throw new AuthConfigError("VOSS_DISCOVERY_URL may use http only for localhost.");
  }
  const suffix = "/.well-known/openid-configuration";
  if (!discovery.pathname.endsWith(suffix) || discovery.search || discovery.hash) {
    throw new AuthConfigError(`VOSS_DISCOVERY_URL must end with ${suffix} and carry no query or fragment.`);
  }
  const issuer = `${discovery.origin}${discovery.pathname.slice(0, -suffix.length)}`;

  let oauth: OAuthClientConfig | null = null;
  const haveId = Boolean(env.VOSS_CLIENT_ID?.trim());
  const haveSecret = Boolean(env.VOSS_CLIENT_SECRET?.trim());
  if (!oauthOptional || haveId || haveSecret) {
    // Both are required together (and always required unless the dev switcher is enabled).
    const clientId = required(env, "VOSS_CLIENT_ID");
    if (clientId.length > 255 || /\s/.test(clientId)) throw new AuthConfigError("VOSS_CLIENT_ID is malformed.");
    const clientSecret = required(env, "VOSS_CLIENT_SECRET");
    if (clientSecret.length < 16) throw new AuthConfigError("VOSS_CLIENT_SECRET looks too short to be real.");
    oauth = { clientId, clientSecret };
  }

  return {
    baseURL: base.origin,
    secret,
    discoveryUrl,
    issuer,
    oauth,
    secureCookies: base.protocol === "https:",
    production,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Identity rules

// Characters that never belong in an email address we accept (whitespace, control chars, list separators).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_EMAIL_CHARS = /[\s\u0000-\u001f\u007f,;<>()[\]\\"]/;

/** Exact-domain allowlist check. `a@evil.com@vit.edu.in` has two @ signs and is rejected. */
export function isAllowedEmail(email: unknown): email is string {
  if (typeof email !== "string" || email.length === 0 || email.length > 320) return false;
  if (FORBIDDEN_EMAIL_CHARS.test(email)) return false;
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

export type RejectionReason = "sub_invalid" | "email_missing" | "email_not_verified" | "email_domain_not_allowed";

export interface VerifiedIdentity {
  /** The stable external identity (OIDC `sub`). */
  sub: string;
  /** Lower-cased. */
  email: string;
  name: string;
  /** Always true: anything else is rejected. */
  emailVerified: true;
}

export type ClaimsResult =
  { ok: true; identity: VerifiedIdentity } | { ok: false; reason: RejectionReason; sub?: string };

/** A usable `sub`: a non-empty string of printable characters, no longer than app_user.vauth_subject allows. */
/* eslint-disable no-control-regex -- these rules exist precisely to reject control characters */
export function isValidSubject(sub: unknown): sub is string {
  return (
    typeof sub === "string" &&
    sub.length > 0 &&
    sub.length <= 255 &&
    sub === sub.trim() &&
    !/[\u0000-\u001f\u007f\s]/.test(sub)
  );
}

export function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return name || email;
}

/** `name` is optional in OIDC. Use it if usable, otherwise derive one; never return an empty name. */
export function normalizeName(name: unknown, email: string): string {
  if (typeof name === "string") {
    const cleaned = name
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (cleaned) return cleaned;
  }
  return deriveNameFromEmail(email).slice(0, 200);
}
/* eslint-enable no-control-regex */

/**
 * Applies Vshow's rules to the (already signature-verified) ID token claims. Strict by design:
 * `email_verified` must be the boolean true, the domain must be on the allowlist, `sub` must be well formed.
 */
export function evaluateClaims(claims: Record<string, unknown>): ClaimsResult {
  if (!isValidSubject(claims.sub)) return { ok: false, reason: "sub_invalid" };
  const sub = claims.sub;
  if (typeof claims.email !== "string" || claims.email.length === 0) return { ok: false, reason: "email_missing", sub };
  if (claims.email_verified !== true) return { ok: false, reason: "email_not_verified", sub };
  if (!isAllowedEmail(claims.email)) return { ok: false, reason: "email_domain_not_allowed", sub };
  const email = claims.email.toLowerCase();
  return { ok: true, identity: { sub, email, name: normalizeName(claims.name, email), emailVerified: true } };
}

// ---------------------------------------------------------------------------------------------------------
// Local development identity switcher

export class DevAuthError extends Error {
  override name = "DevAuthError";
}

export interface DevAuthDecision {
  enabled: boolean;
}

/**
 * Decides whether the dev identity switcher may exist. It is OFF unless VSHOW_DEV_AUTH is exactly "1".
 * When the flag is set and ANY other condition fails, this THROWS (the server must refuse to start with an
 * unsafe flag rather than quietly ignoring it). The database check is injected so callers pass the shared
 * Compose-database guard (app/db/local-target.server.ts); this module stays free of database knowledge.
 */
export function resolveDevAuth(env: Env, assertLocalDatabase: () => void): DevAuthDecision {
  const flag = env.VSHOW_DEV_AUTH?.trim();
  if (!flag) return { enabled: false };
  const fail = (why: string): never => {
    throw new DevAuthError(`VSHOW_DEV_AUTH is set but ${why}. Refusing to start.`);
  };
  if (flag !== "1") fail('its value is not exactly "1"');
  if (env.APP_ENV?.trim() !== "development") fail("APP_ENV is not development");
  if (env.NODE_ENV === "production") fail("NODE_ENV is production");
  if (env.VERCEL || env.VERCEL_ENV) fail("a Vercel runtime was detected");
  let host = "";
  try {
    host = new URL(env.BETTER_AUTH_URL ?? "").hostname;
  } catch {
    /* handled below */
  }
  if (!LOCAL_HOSTS.has(host)) fail("BETTER_AUTH_URL is not localhost");
  try {
    assertLocalDatabase();
  } catch {
    fail("the database is not the local Compose database");
  }
  return { enabled: true };
}
