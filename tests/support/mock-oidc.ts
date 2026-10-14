// A small, honest OpenID Connect provider for tests. It behaves like vauth where it matters for Vshow:
// authorization code flow, PKCE S256 enforced at the token endpoint, client_secret_post, `iss` on the
// authorization response, EdDSA-signed ID tokens, JWKS and discovery. Every failure mode a test needs is a
// knob on `tweaks`, reset between scenarios. It is test-only and listens on a random loopback port.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";

export interface Profile {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  [claim: string]: unknown;
}

export interface Tweaks {
  /** Claims for the next ID token. `undefined` values are omitted from the token. */
  profile: Profile;
  /** Overrides applied to the ID token envelope. */
  token: {
    iss?: string;
    aud?: string | string[];
    /** Seconds relative to now; negative means already expired. */
    expiresInSeconds?: number;
    issuedAtOffsetSeconds?: number;
    /** Sign with an RSA/ES key or HMAC instead of the published EdDSA key. */
    alg?: "EdDSA" | "ES256" | "HS256" | "none";
    /** Sign with a key that is NOT in the JWKS. */
    unknownKey?: boolean;
    omitIdToken?: boolean;
  };
  /** Overrides applied to the authorization response (the redirect back to Vshow). */
  authorize: { omitIss?: boolean; iss?: string; state?: string };
  /** Make the token endpoint believe the PKCE challenge was different (simulates a wrong verifier). */
  breakPkce?: boolean;
  /** Return an error from the token endpoint. */
  tokenError?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
}

export interface MockIdp {
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  tweaks: Tweaks;
  requests: RecordedRequest[];
  /** Everything the IdP handed to Vshow, so tests can prove none of it was logged or stored. */
  issued: { codes: string[]; accessTokens: string[]; refreshTokens: string[]; idTokens: string[] };
  reset(): void;
  close(): Promise<void>;
}

const defaultProfile = (): Profile => ({
  sub: "vauth-user-0001",
  email: "student.one@vit.edu.in",
  email_verified: true,
  name: "Student One",
});

const b64url = (b: Buffer) => b.toString("base64url");
const sha256b64url = (s: string) => b64url(createHash("sha256").update(s).digest());

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export async function startMockIdp(
  clientId = "vshow-test-client",
  clientSecret = "test-client-secret-0123456789",
): Promise<MockIdp> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  const other = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true }); // never published
  const es = await generateKeyPair("ES256");
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: "mock-key-1", alg: "EdDSA", use: "sig" };
  // A second, PUBLISHED key of a different algorithm. A verifier that does not pin EdDSA would accept a token
  // signed with it, so this is what makes the algorithm-pinning test meaningful.
  const esJwk: JWK = { ...(await exportJWK(es.publicKey)), kid: "mock-key-es", alg: "ES256", use: "sig" };

  const codes = new Map<string, { challenge: string; redirectUri: string; used: boolean }>();
  const issued = {
    codes: [] as string[],
    accessTokens: [] as string[],
    refreshTokens: [] as string[],
    idTokens: [] as string[],
  };
  const requests: RecordedRequest[] = [];
  let port = 0;
  let tweaks: Tweaks;
  const reset = () => {
    tweaks = { profile: defaultProfile(), token: {}, authorize: {} };
    requests.length = 0;
  };
  reset();

  const origin = () => `http://127.0.0.1:${port}`;
  const issuerUrl = () => `${origin()}/api/auth`;

  async function signIdToken(): Promise<string> {
    const t = tweaks.token;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tweaks.profile)) if (v !== undefined) claims[k] = v;
    const body = {
      ...claims,
      iss: t.iss ?? issuerUrl(),
      aud: t.aud ?? clientId,
      iat: now + (t.issuedAtOffsetSeconds ?? 0),
      exp: now + (t.expiresInSeconds ?? 600),
    };
    if (t.alg === "none") {
      const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      return `${enc({ alg: "none", typ: "JWT" })}.${enc(body)}.`;
    }
    if (t.alg === "HS256") {
      return new SignJWT(body)
        .setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode("a-shared-secret-of-sufficient-length"));
    }
    if (t.alg === "ES256") {
      return new SignJWT(body).setProtectedHeader({ alg: "ES256", kid: "mock-key-es" }).sign(es.privateKey);
    }
    const key: CryptoKey = t.unknownKey ? other.privateKey : privateKey;
    return new SignJWT(body).setProtectedHeader({ alg: "EdDSA", kid: "mock-key-1" }).sign(key);
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin());
    requests.push({ method: req.method ?? "GET", path: url.pathname });

    if (url.pathname === "/api/auth/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer: issuerUrl(),
        authorization_endpoint: `${issuerUrl()}/oauth2/authorize`,
        token_endpoint: `${issuerUrl()}/oauth2/token`,
        jwks_uri: `${issuerUrl()}/jwks`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["EdDSA"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        scopes_supported: ["openid", "profile", "email"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url.pathname === "/api/auth/jwks") return json(res, 200, { keys: [publicJwk, esJwk] });

    if (url.pathname === "/api/auth/oauth2/authorize") {
      const q = url.searchParams;
      const redirect = q.get("redirect_uri") ?? "";
      if (q.get("client_id") !== clientId || q.get("response_type") !== "code")
        return json(res, 400, { error: "invalid_request" });
      if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge"))
        return json(res, 400, { error: "pkce_required" });
      const code = b64url(randomBytes(24));
      codes.set(code, { challenge: q.get("code_challenge") as string, redirectUri: redirect, used: false });
      issued.codes.push(code);
      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", tweaks.authorize.state ?? q.get("state") ?? "");
      if (!tweaks.authorize.omitIss) back.searchParams.set("iss", tweaks.authorize.iss ?? issuerUrl());
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (url.pathname === "/api/auth/oauth2/token" && req.method === "POST") {
      const f = await readForm(req);
      if (tweaks.tokenError) return json(res, 400, { error: "server_error" });
      if (f.get("grant_type") !== "authorization_code") return json(res, 400, { error: "unsupported_grant_type" });
      if (f.get("client_id") !== clientId || f.get("client_secret") !== clientSecret)
        return json(res, 401, { error: "invalid_client" });
      const entry = codes.get(f.get("code") ?? "");
      if (!entry || entry.used) return json(res, 400, { error: "invalid_grant" });
      entry.used = true; // single use, consumed before any further check (like vauth)
      if (f.get("redirect_uri") !== entry.redirectUri) return json(res, 400, { error: "invalid_grant" });
      const verifier = f.get("code_verifier") ?? "";
      const expected = tweaks.breakPkce ? "not-the-challenge" : entry.challenge;
      if (!verifier || sha256b64url(verifier) !== expected)
        return json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });

      const access = `mock-access-token-${b64url(randomBytes(12))}`;
      const refresh = `mock-refresh-token-${b64url(randomBytes(12))}`;
      issued.accessTokens.push(access);
      issued.refreshTokens.push(refresh);
      const payload: Record<string, unknown> = {
        access_token: access,
        refresh_token: refresh,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid profile email",
      };
      if (!tweaks.token.omitIdToken) {
        const id = await signIdToken();
        issued.idTokens.push(id);
        payload.id_token = id;
      }
      return json(res, 200, payload);
    }

    json(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;

  return {
    get issuer() {
      return issuerUrl();
    },
    get discoveryUrl() {
      return `${issuerUrl()}/.well-known/openid-configuration`;
    },
    clientId,
    clientSecret,
    get tweaks() {
      return tweaks;
    },
    requests,
    issued,
    reset,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
