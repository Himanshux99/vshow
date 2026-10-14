import { Form } from "react-router";
import type { Route } from "./+types/unclaimed";
import { requireUnassigned } from "../auth/authorize.server";
import { getRequestScope } from "../server/request-scope.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Access not set up · Vshow" }];
}

// The explicit dead end for a verified VOSS identity that Vshow knows nothing about. No role is granted here.
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUnassigned(getRequestScope(context), request);
  return { displayName: user.displayName, email: user.email };
}

export default function Unclaimed({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-2xl font-semibold">Your access is not set up yet</h1>
      <p className="mt-3 text-sm">
        You are signed in as <strong>{loaderData.displayName}</strong> ({loaderData.email}), but a Vshow administrator
        has not assigned you a role. Ask Corporate Communication to set up your access, then sign in again.
      </p>
      <Form method="post" action="/logout" className="mt-6">
        <button type="submit" className="rounded border px-4 py-2">
          Sign out
        </button>
      </Form>
    </main>
  );
}
