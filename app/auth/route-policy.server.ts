// Default-deny policy for requests that reach Vshow's /api/auth/* route. Only the endpoints Vshow actually
// needs over HTTP are forwarded to Better Auth; everything else is a 404, including endpoints a future
// Better Auth release might add. Sign-in start, session reads and sign-out are performed server-side through
// `auth.api` by Vshow's own routes (/login, /logout), so they are NOT exposed here.
import { VAUTH } from "./config.server.ts";
import { DEV_SIGN_IN_PATH } from "./dev-switcher.server.ts";

const AUTH_PREFIX = "/api/auth";

export interface RoutePolicyOptions {
  devAuth: { enabled: boolean };
}

/** True if the request may be forwarded to Better Auth. */
export function isAllowedAuthRequest(method: string, pathname: string, { devAuth }: RoutePolicyOptions): boolean {
  if (!pathname.startsWith(`${AUTH_PREFIX}/`)) return false;
  const path = pathname.slice(AUTH_PREFIX.length); // e.g. "/oauth2/callback/voss"
  const verb = method.toUpperCase();

  // The OAuth redirect target registered with vauth. Exactly this provider, exactly GET.
  if (verb === "GET" && path === `/oauth2/callback/${VAUTH.providerId}`) return true;
  if (verb === "GET" && path === "/ok") return true;
  // Exists only in local development with every guard satisfied (the plugin is not registered otherwise).
  if (devAuth.enabled && verb === "POST" && path === DEV_SIGN_IN_PATH) return true;
  return false;
}

/** Headers for every /api/auth/* response: callback URLs carry OAuth parameters and must not be cached or leaked. */
export const AUTH_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;
