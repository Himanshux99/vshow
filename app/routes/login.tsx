import { Form, data, redirect } from "react-router";
import type { Route } from "./+types/login";
import { assertSameOrigin, authUnavailable, resolveAccess } from "../auth/authorize.server";
import { AuthConfigError } from "../auth/config.server";
import { getRequestScope } from "../server/request-scope.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Sign in · Vshow" }];
}

// Fixed messages only. The `error` query parameter is a code, never text to display.
const MESSAGES: Record<string, string> = {
  inactive: "This account has been deactivated.",
  account_not_linked:
    "This email already has a local account that cannot be linked automatically. Contact an administrator.",
  issuer_missing: "Sign-in could not be verified. Please try again.",
  issuer_mismatch: "Sign-in could not be verified. Please try again.",
  state_mismatch: "Your sign-in session expired. Please try again.",
  state_security_mismatch: "Your sign-in session expired. Please try again.",
  oauth_code_verification_failed: "Sign-in could not be completed. Please try again.",
  user_info_is_missing:
    "Your VOSS account could not be used to sign in. Only verified @vit.edu.in and @vosslabs.org addresses are allowed.",
};
const GENERIC = "Sign-in failed. Please try again.";

export async function loader({ request, context }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const url = new URL(request.url);
  const code = url.searchParams.get("error");

  // Already signed in? Skip the form. (If auth is not configured here, show the page with a clear notice.)
  let available: boolean;
  try {
    const access = await resolveAccess(scope, request.headers);
    if (access.status === "ok") throw redirect("/me");
    if (access.status === "unassigned") throw redirect("/unclaimed");
    // No registered vauth client (local development before registration): the sign-in button is replaced by a notice.
    available = scope.auth.config().oauth !== null;
  } catch (err) {
    if (err instanceof AuthConfigError) available = false;
    else throw err;
  }
  return {
    available,
    message: code ? (MESSAGES[code] ?? GENERIC) : null,
    devAuth: scope.auth.devAuth.enabled,
  };
}

/** Starts the vauth sign-in. All OAuth work (PKCE, state) happens server-side; the browser just follows the redirect. */
export async function action({ request, context }: Route.ActionArgs) {
  const scope = getRequestScope(context);
  let config: ReturnType<typeof scope.auth.config>;
  try {
    config = scope.auth.config();
  } catch (err) {
    if (err instanceof AuthConfigError) authUnavailable(scope, err); // a fixed 503; never a 500
    throw err;
  }
  assertSameOrigin(request, config.baseURL);
  if (!config.oauth) throw data(null, { status: 503 }); // vauth client not configured

  const response = await scope.auth.get().api.signInWithOAuth2({
    body: { providerId: "voss", callbackURL: "/me" },
    headers: request.headers,
    asResponse: true,
  });
  const { url } = (await response.json()) as { url?: string };
  if (!url) return redirect("/login?error=start_failed");

  // Forward every Set-Cookie (the signed state cookie) to the browser along with the redirect.
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  headers.set("cache-control", "no-store");
  return redirect(url, { headers });
}

export default function Login({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-2xl font-semibold">Vshow</h1>
      <p className="mt-2 text-sm text-gray-600">Campus signage media approval. Sign in with your VOSS account.</p>
      {loaderData.message && (
        <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {loaderData.message}
        </p>
      )}
      {loaderData.available ? (
        <Form method="post" action="/login" className="mt-6">
          <button type="submit" className="w-full rounded bg-black px-4 py-2 text-white">
            Sign in with VOSS
          </button>
        </Form>
      ) : (
        <p role="alert" className="mt-6 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">
          Sign-in is not available right now.
        </p>
      )}
      {loaderData.devAuth && (
        <p className="mt-6 text-sm">
          <a className="underline" href="/dev/login">
            Local development identity switcher
          </a>
        </p>
      )}
    </main>
  );
}
