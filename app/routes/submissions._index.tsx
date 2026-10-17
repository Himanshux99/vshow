import { Link } from "react-router";
import type { Route } from "./+types/submissions._index";
import { requireRole } from "../auth/authorize.server";
import { AppShell } from "../components/app-header";
import { EmptyState, PageHeader } from "../components/ui";
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
    <AppShell roles={roles}>
      <PageHeader
        eyebrow="Convener"
        title="My submissions"
        description="Media requests for the committees you belong to, and where each one stands."
        actions={
          canCreate && (
            <Link to="/submissions/new" className="btn">
              New submission
            </Link>
          )
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="No submissions yet"
          action={
            canCreate && (
              <Link to="/submissions/new" className="btn btn-ghost">
                Start a submission
              </Link>
            )
          }
        >
          Nothing has been created for your committees. Drafts stay private to your committee until you send them for
          review.
        </EmptyState>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Your submissions">
          <table className="vtable">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Title</th>
                <th scope="col">Committee</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link className="link mono tabular" to={`/submissions/${s.id}`}>
                      {s.referenceCode}
                    </Link>
                  </td>
                  <td className="max-w-80 font-medium">{s.title}</td>
                  <td className="text-dim">{s.committeeName}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="tabular whitespace-nowrap text-dim">{formatCampus(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
