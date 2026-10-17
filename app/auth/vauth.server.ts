// Verifies vauth ID tokens and turns them into a Vshow identity. Better Auth's generic OAuth plugin by default
// only DECODES the ID token (no signature check); this module is what actually authenticates it:
//   - the discovery document is fetched and its `issuer` must equal the configured issuer;
//   - the signing keys come from that issuer's JWKS (same origin as the issuer);
//   - the JWT must be EdDSA-signed, with the expected issuer, our client ID as audience, unexpired,
//     and issued recently; only then are the claims evaluated against Vshow's identity rules.
// Failures never throw into Better Auth: they return null (it then redirects to the error page) and log a
// reason code that contains no token, code, state or profile data.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";
import type { Logger } from "../logging/logger.server.ts";
import { VAUTH, evaluateClaims, type AuthConfig, type RejectionReason } from "./config.server.ts";
import type { IdentityStore } from "./identity-store.server.ts";

export type VerifyFailure =
  "discovery_unavailable" | "discovery_invalid" | "discovery_issuer_mismatch" | "jwks_uri_invalid" | "token_invalid";

export class IdTokenError extends Error {
  override name = "IdTokenError";
  readonly reason: VerifyFailure;
  constructor(reason: VerifyFailure) {
    super(`ID token could not be verified (${reason})`);
    this.reason = reason;
  }
}

export interface IdTokenVerifierOptions {
  /** `clientId` is the expected ID-token audience. */
  config: Pick<AuthConfig, "issuer" | "discoveryUrl"> & { clientId: string };
  fetchImpl?: typeof fetch;
  /** Test seam: replaces the JWKS resolver (the production path builds a remote JWKS from discovery). */
  getKey?: JWTVerifyGetKey;
  discoveryTtlMs?: number;
}

export interface IdTokenVerifier {
  verify(idToken: string): Promise<JWTPayload>;
}

const DISCOVERY_TIMEOUT_MS = 5_000;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function createIdTokenVerifier({
  config,
  fetchImpl = fetch,
  getKey,
  discoveryTtlMs = 60 * 60 * 1000,
}: IdTokenVerifierOptions): IdTokenVerifier {
  let cached: { jwks: JWTVerifyGetKey; loadedAt: number } | undefined;

  async function loadJwks(): Promise<JWTVerifyGetKey> {
    if (getKey) return getKey;
    if (cached && Date.now() - cached.loadedAt < discoveryTtlMs) return cached.jwks;

    let doc: unknown;
    try {
      const res = await fetchImpl(config.discoveryUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        redirect: "error",
      });
      if (!res.ok) throw new Error("bad status");
      doc = await res.json();
    } catch {
      throw new IdTokenError("discovery_unavailable");
    }
    if (typeof doc !== "object" || doc === null) throw new IdTokenError("discovery_invalid");
    const { issuer, jwks_uri: jwksUri } = doc as { issuer?: unknown; jwks_uri?: unknown };
    if (issuer !== config.issuer) throw new IdTokenError("discovery_issuer_mismatch");
    if (typeof jwksUri !== "string") throw new IdTokenError("jwks_uri_invalid");

    let url: URL;
    try {
      url = new URL(jwksUri);
    } catch {
      throw new IdTokenError("jwks_uri_invalid");
    }
    const issuerUrl = new URL(config.issuer);
    const secure = url.protocol === "https:" || LOCAL.has(url.hostname);
    if (!secure || url.origin !== issuerUrl.origin) throw new IdTokenError("jwks_uri_invalid");

    const jwks = createRemoteJWKSet(url, {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      timeoutDuration: 5_000,
    });
    cached = { jwks, loadedAt: Date.now() };
    return jwks;
  }

  return {
    async verify(idToken) {
      const jwks = await loadJwks();
      try {
        const { payload } = await jwtVerify(idToken, jwks, {
          issuer: config.issuer,
          audience: config.clientId,
          algorithms: [...VAUTH.idTokenAlgorithms],
          requiredClaims: ["sub", "iat", "exp"],
          clockTolerance: 60,
          maxTokenAge: "15 minutes",
        });
        return payload;
      } catch {
        // Signature, issuer, audience, algorithm, expiry, age: all collapse into one safe reason.
        throw new IdTokenError("token_invalid");
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------

export interface VauthUserInfo {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface UserInfoDeps {
  verifier: IdTokenVerifier;
  store: IdentityStore;
  logger: Logger;
}

const SESSION_REVOKING: ReadonlySet<RejectionReason> = new Set([
  "email_missing",
  "email_not_verified",
  "email_domain_not_allowed",
]);

/**
 * Builds the `getUserInfo` function for Better Auth's generic OAuth provider. It is the single place where
 * provider claims become a Vshow identity. Returns null (sign-in denied) on any problem.
 */
export function createUserInfoResolver({ verifier, store, logger }: UserInfoDeps) {
  return async function getUserInfo(tokens: { idToken?: string | null }): Promise<VauthUserInfo | null> {
    if (!tokens.idToken) {
      logger.warn("sign-in denied: provider returned no ID token", { reason: "id_token_missing" });
      return null;
    }

    let claims: JWTPayload;
    try {
      claims = await verifier.verify(tokens.idToken);
    } catch (err) {
      const reason = err instanceof IdTokenError ? err.reason : "token_invalid";
      logger.warn("sign-in denied: ID token verification failed", { reason });
      return null;
    }

    const result = evaluateClaims(claims);
    if (!result.ok) {
      logger.warn("sign-in denied: identity rejected by policy", { reason: result.reason });
      // The provider vouched for this subject (signature verified) but its email no longer qualifies: end any
      // sessions the corresponding local user still holds, so access ends now rather than at expiry.
      if (result.sub && SESSION_REVOKING.has(result.reason)) {
        const existing = await store.findUserBySubject(result.sub);
        if (existing) {
          await store.revokeSessions(existing.id);
          logger.warn("sessions revoked: identity no longer meets the email policy", { userId: existing.id });
        }
      }
      return null;
    }

    const { identity } = result;
    // A known subject returning with a changed (but acceptable) email: update it, never merge, never transfer.
    const existing = await store.findUserBySubject(identity.sub);
    if (existing && existing.email !== identity.email) {
      const outcome = await store.changeEmail(existing.id, identity.email);
      if (outcome === "conflict") {
        logger.warn("sign-in denied: new email already belongs to another user", {
          reason: "email_conflict",
          userId: existing.id,
        });
        return null;
      }
      logger.info("email updated for an existing identity", { userId: existing.id });
    }

    return { id: identity.sub, email: identity.email, emailVerified: true, name: identity.name };
  };
}
