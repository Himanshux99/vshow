import { Form, Link } from "react-router";
import type { Route } from "./+types/me";
import { requireAssignedUser } from "../auth/authorize.server";
import { getRequestScope } from "../server/request-scope.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Your account · Vshow" }];
}

// The first protected route. It authorizes in its OWN loader (never trusting a parent or the UI): the
// current user and their roles are re-read from the database on every request.
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireAssignedUser(getRequestScope(context), request);
  return {
    displayName: user.displayName,
    email: user.email,
    roles: user.roles,
    committees: user.memberships.map((m) => ({ code: m.committeeCode, type: m.membershipType })),
  };
}

export default function Me({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <h1 className="text-2xl font-semibold">{loaderData.displayName}</h1>
      <p className="text-sm text-gray-600">{loaderData.email}</p>
      <h2 className="mt-6 font-medium">Roles</h2>
      <ul className="list-disc pl-5 text-sm">
        {loaderData.roles.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <h2 className="mt-4 font-medium">Committees</h2>
      <ul className="list-disc pl-5 text-sm">
        {loaderData.committees.length === 0 && <li>None</li>}
        {loaderData.committees.map((c) => (
          <li key={c.code}>
            {c.code} ({c.type})
          </li>
        ))}
      </ul>
      <nav className="mt-6 flex gap-4 text-sm">
        {loaderData.roles.includes("CONVENER") && (
          <Link className="underline" to="/submissions">
            My submissions
          </Link>
        )}
        {loaderData.roles.includes("REVIEWER") && (
          <Link className="underline" to="/review">
            Review queue
          </Link>
        )}
      </nav>
      <Form method="post" action="/logout" className="mt-6">
        <button type="submit" className="rounded border px-4 py-2">
          Sign out
        </button>
      </Form>
    </main>
  );
}
