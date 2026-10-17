// Local development identity switcher page. In every environment where the switcher is not enabled (that is,
// everywhere except a guarded local run) this route answers 404 and does nothing; its action re-checks.
import { Form, data } from "react-router";
import type { Route } from "./+types/dev.login";
import { handleDevLogin } from "../auth/dev-login.server";
import { DEV_IDENTITY_KEYS } from "../auth/dev-switcher.server";
import { getRequestScope } from "../server/request-scope.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Dev identity switcher · Vshow" }];
}

export function loader({ context }: Route.LoaderArgs) {
  if (!getRequestScope(context).auth.devAuth.enabled) throw data(null, { status: 404 });
  return { identities: [...DEV_IDENTITY_KEYS] };
}

export async function action({ request, context }: Route.ActionArgs) {
  const scope = getRequestScope(context);
  if (!scope.auth.devAuth.enabled) throw data(null, { status: 404 });
  return handleDevLogin(scope, request); // re-checks the flag itself
}

export default function DevLogin({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-xl font-semibold">Development identity switcher</h1>
      <p className="mt-2 text-sm text-yellow-800">
        Local development only. These are seeded test identities; roles still come from the database.
      </p>
      <Form method="post" className="mt-4 flex flex-col gap-2">
        {loaderData.identities.map((key) => (
          <button key={key} type="submit" name="identity" value={key} className="rounded border px-3 py-2 text-left">
            {key}
          </button>
        ))}
      </Form>
    </main>
  );
}
