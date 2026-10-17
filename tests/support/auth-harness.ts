// Drives a REAL Better Auth instance (the one Vshow ships) through the full OAuth flow against the mock
// identity provider, with a real disposable database. No network beyond loopback, no real credentials.
import { createDbProvider, type DbProvider } from "../../app/db/client.server.ts";
import { resolveDbConfig } from "../../app/db/config.server.ts";
import { buildAuth, type Auth } from "../../app/auth/auth.server.ts";
import { resolveAuthConfig, type AuthConfig, type DevAuthDecision } from "../../app/auth/config.server.ts";
import pg from "pg";
import { captureLogs, createThrowawayDb, runNode } from "../helpers.ts";
import { startMockIdp, type MockIdp } from "./mock-oidc.ts";

export const TEST_SECRET = "test-secret-for-better-auth-0123456789abcdef";

export class CookieJar {
  private cookies = new Map<string, string>();
  add(setCookies: string[]) {
    for (const line of setCookies) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const maxAge = attrs.find((a) => /^max-age=/i.test(a))?.split("=")[1];
      if (value === "" || maxAge === "0") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  names() {
    return [...this.cookies.keys()];
  }
}

export interface SignInResult {
  status: number;
  location: string | null;
  /** The `error` query parameter of the redirect, when sign-in failed. */
  errorCode: string | null;
  jar: CookieJar;
  setCookies: string[];
  /** The callback URL the identity provider redirected to (contains code and state). */
  callbackUrl: string;
}

export interface AuthHarness {
  idp: MockIdp;
  baseURL: string;
  config: AuthConfig;
  auth: Auth;
  database: DbProvider;
  log: ReturnType<typeof captureLogs>;
  skipReason: string;
  /** Connection URL of the disposable database (test use only). */
  dbUrl: string;
  q: <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>;
  signIn(jar?: CookieJar): Promise<SignInResult>;
  /** Begins the flow and returns the authorization URL, state cookie and PKCE challenge, without completing it. */
  begin(jar?: CookieJar): Promise<{ authorizeUrl: string; jar: CookieJar }>;
  getSession(jar: CookieJar): ReturnType<Auth["api"]["getSession"]>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  baseURL?: string;
  devAuth?: DevAuthDecision;
}

export async function createAuthHarness(options: HarnessOptions = {}): Promise<AuthHarness> {
  const idp = await startMockIdp();
  const db = await createThrowawayDb("vshow_test_authflow");
  const baseURL = options.baseURL ?? "http://localhost:5173";
  const log = captureLogs();

  const base = {
    idp,
    baseURL,
    log,
    skipReason: db.skipReason,
  };
  if (db.skipReason) {
    await idp.close();
    return { ...base, skipReason: db.skipReason } as unknown as AuthHarness;
  }

  const migrate = runNode(["scripts/db-migrate.ts"], {
    DB_TARGET: "local",
    DATABASE_URL: db.url,
    DATABASE_URL_DIRECT: "",
  });
  if (migrate.status !== 0) throw new Error(`test database migration failed: ${migrate.stderr}`);

  const config = resolveAuthConfig({
    BETTER_AUTH_SECRET: TEST_SECRET,
    BETTER_AUTH_URL: baseURL,
    VOSS_DISCOVERY_URL: idp.discoveryUrl,
    VOSS_CLIENT_ID: idp.clientId,
    VOSS_CLIENT_SECRET: idp.clientSecret,
  });
  const database = createDbProvider({
    resolveConfig: () => resolveDbConfig({ DB_TARGET: "local", DATABASE_URL: db.url }, "runtime"),
    logger: log.logger,
  });
  const auth = buildAuth({ config, database, logger: log.logger, devAuth: options.devAuth ?? { enabled: false } });

  const q = async <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) => {
    const c = new pg.Client({ connectionString: db.url });
    await c.connect();
    try {
      return (await c.query<T>(sql, params)).rows;
    } finally {
      await c.end();
    }
  };

  async function begin(jar = new CookieJar()) {
    const res = await auth.api.signInWithOAuth2({
      body: { providerId: "voss", callbackURL: "/me" },
      headers: new Headers({ origin: baseURL }),
      asResponse: true,
    });
    jar.add(res.headers.getSetCookie());
    const body = (await res.json()) as { url: string };
    return { authorizeUrl: body.url, jar };
  }

  async function signIn(jar = new CookieJar()): Promise<SignInResult> {
    const { authorizeUrl } = await begin(jar);
    const authz = await fetch(authorizeUrl, { redirect: "manual" });
    const callbackUrl = authz.headers.get("location");
    if (!callbackUrl) throw new Error(`mock IdP did not redirect (status ${authz.status})`);
    const res = await auth.handler(new Request(callbackUrl, { headers: { cookie: jar.header() } }));
    const setCookies = res.headers.getSetCookie();
    jar.add(setCookies);
    const location = res.headers.get("location");
    const errorCode = location ? new URL(location, baseURL).searchParams.get("error") : null;
    return { status: res.status, location, errorCode, jar, setCookies, callbackUrl };
  }

  return {
    ...base,
    skipReason: "",
    dbUrl: db.url,
    config,
    auth,
    database,
    q,
    begin,
    signIn,
    getSession: (jar) => auth.api.getSession({ headers: new Headers({ cookie: jar.header() }) }),
    async close() {
      await database.close();
      await idp.close();
      await db.drop();
    },
  };
}
