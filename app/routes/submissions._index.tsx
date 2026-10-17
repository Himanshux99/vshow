import { Link } from "react-router";
import type { Route } from "./+types/submissions._index";
import { requireRole } from "../auth/authorize.server";
import { AppHeader } from "../components/app-header";
import { StatusBadge } from "../components/workflow-ui";
import { listConvenerSubmissions } from "../submissions/queries.server";
import { getRequestScope } from "../server/request-scope.server";
import { formatCampus } from "../submissions/time";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "My submissions · Vshow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["CONVENER"]);
  const items = await listConvenerSubmissions(scope.database.get(), user);
  return { roles: user.roles, canCreate: user.memberships.length > 0, items };
}

export default function Submissions({ loaderData }: Route.ComponentProps) {
  const { items, roles, canCreate } = loaderData;
  return (
    <>
      <AppHeader roles={roles} />
      <main className="mx-auto max-w-4xl p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">My submissions</h1>
          {canCreate && (
            <Link to="/submissions/new" className="rounded bg-black px-3 py-1.5 text-sm text-white">
              New submission
            </Link>
          )}
        </div>
        {items.length === 0 ? (
          <p className="mt-6 text-sm text-gray-600">
            No submissions yet for your committees.{canCreate ? " Start one with “New submission”." : ""}
          </p>
        ) : (
          <table className="mt-6 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3">Reference</th>
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Committee</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="py-2 pr-3">
                    <Link className="underline" to={`/submissions/${s.id}`}>
                      {s.referenceCode}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{s.title}</td>
                  <td className="py-2 pr-3">{s.committeeName}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-2">{formatCampus(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
