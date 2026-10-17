// Local development identity switcher page. In every environment where the switcher is not enabled (that is,
// everywhere except a guarded local run) this route answers 404 and does nothing; its action re-checks.
import { Form, data } from "react-router";
import type { Route } from "./+types/dev.login";
import { handleDevLogin } from "../auth/dev-login.server";
import { DEV_IDENTITY_KEYS } from "../auth/dev-switcher.server";
import { PublicHeader } from "../components/app-header";
import { Notice } from "../components/ui";
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
    <>
      <PublicHeader action={<span />} />
      <main id="main" tabIndex={-1} className="container-voss page outline-none">
        <div className="mx-auto max-w-md pt-10">
          <p className="eyebrow eyebrow-brand mb-3">Local development only</p>
          <h1 className="page-title">Identity switcher</h1>
          <div className="mt-4">
            <Notice tone="warn">These are seeded test identities; roles still come from the database.</Notice>
          </div>
          <Form method="post" className="mt-6 flex flex-col gap-2">
            {loaderData.identities.map((key) => (
              <button key={key} type="submit" name="identity" value={key} className="btn btn-ghost mono justify-start">
                {key}
              </button>
            ))}
          </Form>
        </div>
      </main>
    </>
  );
}
