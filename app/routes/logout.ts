import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { assertSameHost, assertSameOrigin } from "../auth/authorize.server";
import { AuthConfigError } from "../auth/config.server";
import { expiredAuthCookies } from "../auth/session-cookies.server";
import { getRequestScope } from "../server/request-scope.server";

// Visiting /logout directly never signs anyone out (that would be a CSRF-able GET).
export function loader() {
  return redirect("/");
}

/**
 * Ends the Vshow session ONLY. The person stays signed in at vauth (single sign-on); full vauth logout is
 * deliberately not part of this phase. The session row is deleted, so the cookie is useless afterwards.
 *
 * If authentication is unavailable (its configuration is missing or invalid) Better Auth cannot run, so the
 * browser's auth cookies are simply expired and the person is sent to /login. Nothing is contacted (not vauth,
 * not the database) and nothing is granted. Only a configuration problem takes this path: any other error still
 * surfaces as the unexpected failure it is.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const scope = getRequestScope(context);

  let baseURL: string;
  try {
    baseURL = scope.auth.config().baseURL;
  } catch (err) {
    if (!(err instanceof AuthConfigError)) throw err;
    assertSameHost(request); // the configured origin is unavailable, so compare against the request's own host
    scope.logger.warn("signing out locally: authentication is not configured correctly", { reason: err.message });
    const headers = new Headers({ "cache-control": "no-store" });
    for (const cookie of expiredAuthCookies()) headers.append("set-cookie", cookie);
    return redirect("/login", { headers });
  }
  assertSameOrigin(request, baseURL);

  const response = await scope.auth.get().api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  headers.set("cache-control", "no-store");
  return redirect("/login", { headers });
}
