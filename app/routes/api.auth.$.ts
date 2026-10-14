// Mounts Better Auth under /api/auth/*. It exists for one purpose: receiving the OAuth redirect from vauth
// (GET /api/auth/oauth2/callback/voss). Everything else is default-denied by route-policy.server.ts.
//
// Every response carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, because the callback
// URL contains the authorization code and state. The query string is passed to Better Auth untouched (state
// and PKCE validation need it) and is never logged by Vshow: the request logger records the path only.
import type { Route } from "./+types/api.auth.$";
import { AuthConfigError } from "../auth/config.server";
import { AUTH_RESPONSE_HEADERS, isAllowedAuthRequest } from "../auth/route-policy.server";
import { getRequestScope } from "../server/request-scope.server";

function withAuthHeaders(response: Response): Response {
  let out = response;
  try {
    for (const [name, value] of Object.entries(AUTH_RESPONSE_HEADERS)) out.headers.set(name, value);
  } catch {
    // Immutable headers: rebuild without touching the body or the (possibly multiple) Set-Cookie headers.
    out = new Response(response.body, response);
    for (const [name, value] of Object.entries(AUTH_RESPONSE_HEADERS)) out.headers.set(name, value);
  }
  return out;
}

async function handle({ request, context }: { request: Request; context: Route.LoaderArgs["context"] }) {
  const scope = getRequestScope(context);
  const { pathname } = new URL(request.url);

  if (!isAllowedAuthRequest(request.method, pathname, { devAuth: scope.auth.devAuth })) {
    return withAuthHeaders(new Response("Not Found", { status: 404 }));
  }
  try {
    return withAuthHeaders(await scope.auth.get().handler(request));
  } catch (err) {
    if (err instanceof AuthConfigError) {
      // Misconfiguration (missing credentials, bad origin): say so in the logs, tell the browser nothing.
      scope.logger.error("authentication is not configured correctly", { reason: err.message });
      return withAuthHeaders(new Response("Authentication is not available.", { status: 503 }));
    }
    throw err;
  }
}

export const loader = handle;
export const action = handle;
