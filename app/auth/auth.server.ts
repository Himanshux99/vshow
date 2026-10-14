// The Better Auth server instance (pinned 1.6.23). Everything security-relevant is configured explicitly here;
// nothing relies on a library default. See app/auth/README-style comments on each block for the reason.
//
// Built lazily (AuthProvider) so the app boots, and unrelated pages work, even where auth credentials are
// not configured; the first auth request validates the configuration and fails with a clear, secret-free error.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { Db, DbProvider } from "../db/client.server.ts";
import { appUser } from "../db/schema/identity.ts";
import type { Logger } from "../logging/logger.server.ts";
import { authModelOptions, authSchema } from "./schema.server.ts";
import {
  COOKIE_PREFIX,
  SESSION_POLICY,
  VAUTH,
  isAllowedEmail,
  type AuthConfig,
  type DevAuthDecision,
} from "./config.server.ts";
import { devSwitcherPlugin } from "./dev-switcher.server.ts";
import { createIdentityStore } from "./identity-store.server.ts";
import { createIdTokenVerifier, createUserInfoResolver, type IdTokenVerifier } from "./vauth.server.ts";

/**
 * Better Auth endpoints Vshow does not use, switched off as defense in depth. NOTE: Better Auth matches this
 * list against the literal request path, so parametrized routes (`/callback/:id`, `/reset-password/:token`)
 * cannot be listed here. The primary gate is therefore the default-deny allowlist in
 * app/auth/route-policy.server.ts, applied by the /api/auth/* route before a request reaches Better Auth.
 */
export const DISABLED_PATHS = [
  // Linking more accounts, unlinking, and token retrieval (Vshow stores no OAuth tokens and never links).
  "/oauth2/link",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/get-access-token",
  "/refresh-token",
  // Profile / credential / lifecycle changes. Names, emails and roles are owned by vauth and by Vshow admins.
  "/update-user",
  "/update-session",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/reset-password",
  "/request-password-reset",
  "/send-verification-email",
  "/verify-email",
  "/verify-password",
  // Password and social sign-in/up do not exist.
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/social",
  // Better Auth's built-in error page: Vshow redirects errors to its own /login page.
  "/error",
] as const;

export interface BuildAuthOptions {
  config: AuthConfig;
  database: DbProvider;
  logger: Logger;
  devAuth: DevAuthDecision;
  /** Test seam: replaces the real JWKS-backed ID token verifier. */
  verifier?: IdTokenVerifier;
  fetchImpl?: typeof fetch;
}

/** Routes Better Auth's own log output through Vshow's redacting logger. Only Errors and strings survive. */
export function createAuthLogBridge(logger: Logger) {
  return (level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]) => {
    // Better Auth sometimes logs raw provider profiles or request bodies as extra arguments. Never forward
    // them: keep only Error objects (serialized and scrubbed by the logger) and drop everything else.
    const errors = args.filter((a): a is Error => a instanceof Error);
    logger[level](`auth: ${message}`, errors.length ? { err: errors[0] } : undefined);
  };
}

const NULL_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  password: null,
} as const;

export function buildAuth({ config, database, logger, devAuth, verifier, fetchImpl }: BuildAuthOptions) {
  const getDb = (): Db => database.get();
  // The vauth provider exists only when Vshow has a registered client. Without one (local development with the
  // identity switcher, before registration) it is simply not registered, so OAuth sign-in cannot even start.
  const oauthPlugin = config.oauth
    ? (() => {
        const { clientId, clientSecret } = config.oauth;
        const idVerifier =
          verifier ??
          createIdTokenVerifier({
            config: { issuer: config.issuer, discoveryUrl: config.discoveryUrl, clientId },
            fetchImpl,
          });
        const getUserInfo = createUserInfoResolver({ verifier: idVerifier, store: createIdentityStore(getDb), logger });
        return genericOAuth({
          config: [
            {
              providerId: VAUTH.providerId,
              discoveryUrl: config.discoveryUrl,
              clientId,
              clientSecret,
              scopes: [...VAUTH.scopes],
              // PKCE defaults to OFF in Better Auth's client and vauth requires it: be explicit.
              pkce: true,
              requireIssuerValidation: true,
              authentication: "post",
              // The ONLY place provider claims become an identity (signature, issuer, audience, expiry, EdDSA).
              getUserInfo,
            },
          ],
        });
      })()
    : null;

  return betterAuth({
    appName: "Vshow",
    baseURL: config.baseURL,
    secret: config.secret,
    // Exactly one trusted origin: Vshow itself. Better Auth's origin/CSRF checks compare against this.
    trustedOrigins: [config.baseURL],

    // `transaction: true` is REQUIRED: the adapter defaults it to false, which would let a user row be
    // created without its account row. With it, user + account are inserted atomically and a conflicting
    // identity (database trigger) rolls both back.
    database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema, transaction: true }),
    user: { fields: authModelOptions.user.fields },

    // No passwords, ever. vauth is the only way in.
    emailAndPassword: { enabled: false },

    session: {
      expiresIn: SESSION_POLICY.expiresIn,
      updateAge: SESSION_POLICY.updateAge,
      // The cookie cache would let a stale copy of the session authorize requests; roles, memberships and
      // is_active must come from the database every time.
      cookieCache: { enabled: false },
    },

    account: {
      // Never merge an OAuth identity into an existing user because the emails match.
      accountLinking: { enabled: false },
      // Tokens are not stored, so there is nothing to refresh on sign-in (also blocks the update path).
      updateAccountOnSignIn: false,
      storeAccountCookie: false,
    },

    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: "/" },
      ipAddress: { disableIpTracking: true },
      database: { generateId: "uuid" },
    },

    // In-memory limiter: per instance only, so it slows abuse but does not bound it on serverless.
    rateLimit: { enabled: true, window: 60, max: 60 },

    disabledPaths: [...DISABLED_PATHS],
    // Errors during the OAuth callback land on Vshow's own login page, which maps codes to fixed messages.
    onAPIError: { errorURL: `${config.baseURL}/login` },
    logger: { level: "warn", disableColors: true, log: createAuthLogBridge(logger) },

    databaseHooks: {
      user: {
        create: {
          // Second line of defence behind getUserInfo: a user row never comes into existence for an address
          // outside the allowlist or without a verified email. No role is ever assigned here.
          before: async (user) => {
            if (!isAllowedEmail(user.email) || user.emailVerified !== true) return false;
            return { data: { image: null } };
          },
        },
      },
      account: {
        create: {
          before: async (account) => {
            if (account.providerId !== VAUTH.providerId) return false;
            return { data: { ...NULL_TOKENS } };
          },
        },
        update: {
          before: async () => ({ data: { ...NULL_TOKENS } }),
        },
      },
      session: {
        create: {
          before: async (session) => {
            const rows = await getDb()
              .select({ isActive: appUser.isActive })
              .from(appUser)
              .where(eq(appUser.id, session.userId))
              .limit(1);
            if (!rows[0]?.isActive) return false; // unknown or deactivated: no session
            return { data: { ipAddress: null, userAgent: null } };
          },
        },
      },
    },

    plugins: [
      ...(oauthPlugin ? [oauthPlugin] : []),
      // Registered ONLY when every dev-auth guard passed at startup; otherwise the endpoint does not exist.
      ...(devAuth.enabled ? [devSwitcherPlugin({ getDb, logger })] : []),
    ],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

export interface AuthProvider {
  /** Builds the instance on first use (validating configuration); throws AuthConfigError if invalid. */
  get(): Auth;
  /** The validated configuration (throws AuthConfigError if invalid). Contains secrets: never log or return it. */
  config(): AuthConfig;
  readonly devAuth: DevAuthDecision;
}
