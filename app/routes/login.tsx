import { Form, data, redirect } from "react-router";
import type { Route } from "./+types/login";
import { assertSameOrigin, authUnavailable, resolveAccess } from "../auth/authorize.server";
import { AuthConfigError } from "../auth/config.server";
import { landingPath } from "../auth/landing";
import { PublicHeader } from "../components/app-header";
import { Notice } from "../components/ui";
import { SubmitButton } from "../components/workflow-ui";
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
    if (access.status === "ok") throw redirect(landingPath(access.user.roles));
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
    body: { providerId: "voss", callbackURL: "/" },
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
    <>
      <PublicHeader action={<span />} />
      <main id="main" tabIndex={-1} className="container-voss page outline-none">
        <div className="mx-auto max-w-md pt-10 md:pt-20">
          <p className="eyebrow eyebrow-brand mb-3">Sign in</p>
          <h1 className="page-title">Welcome to Vshow</h1>
          <p className="mt-3 text-dim">Campus screen media approval. Sign in with your VOSS account.</p>
          <div className="panel mt-8 space-y-5">
            {loaderData.message && (
              <Notice tone="danger" title="Couldn’t sign you in" role="alert">
                {loaderData.message}
              </Notice>
            )}
            {loaderData.available ? (
              <Form method="post" action="/login">
                <SubmitButton className="btn w-full" pending="Redirecting to VOSS…">
                  Sign in with VOSS <span aria-hidden="true">→</span>
                </SubmitButton>
              </Form>
            ) : (
              <Notice tone="warn" title="Sign-in is not available right now" role="alert">
                Try again later, or contact an administrator if this continues.
              </Notice>
            )}
            <p className="hint">Only verified @vit.edu.in and @vosslabs.org addresses are accepted.</p>
          </div>
          {loaderData.devAuth && (
            <p className="mt-6 text-sm">
              <a className="link" href="/dev/login">
                Local development identity switcher
              </a>
            </p>
          )}
        </div>
      </main>
    </>
  );
}
