// The body of the dev identity switcher's POST action, kept out of the route module so it can be tested directly.
// Every switcher guard is unchanged: the route still refuses unless the switcher is enabled, and the sign-in itself
// goes through the plugin, which re-checks them.
import { data, redirect } from "react-router";
import type { z } from "zod";
import type { RequestScope } from "../server/request-scope.server.ts";
import { assertSameOrigin, authUnavailable } from "./authorize.server.ts";
import { AuthConfigError } from "./config.server.ts";
import { devIdentitySchema } from "./dev-switcher.server.ts";

type Scope = Pick<RequestScope, "auth" | "logger">;

export async function handleDevLogin(scope: Scope, request: Request): Promise<Response> {
  if (!scope.auth.devAuth.enabled) throw data(null, { status: 404 });

  // Missing or invalid authentication configuration (e.g. no BETTER_AUTH_SECRET) is a fixed 503 and no session is
  // created. Only AuthConfigError is handled this way: database and programming errors keep propagating.
  let baseURL: string;
  let auth: ReturnType<Scope["auth"]["get"]>;
  try {
    baseURL = scope.auth.config().baseURL;
    auth = scope.auth.get();
  } catch (err) {
    if (err instanceof AuthConfigError) authUnavailable(scope, err);
    throw err;
  }
  assertSameOrigin(request, baseURL);

  // Only a key from the fixed list is accepted; anything else is rejected before touching the database.
  const form = await request.formData();
  const parsed = devIdentitySchema.safeParse({ identity: form.get("identity") });
  if (!parsed.success) throw data(null, { status: 400 });

  const api = auth.api as unknown as {
    devSignIn(args: { body: z.infer<typeof devIdentitySchema>; headers: Headers; asResponse: true }): Promise<Response>;
  };
  const response = await api.devSignIn({ body: parsed.data, headers: request.headers, asResponse: true });
  if (!response.ok) throw data(null, { status: response.status });

  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  headers.set("cache-control", "no-store");
  return redirect("/me", { headers });
}
