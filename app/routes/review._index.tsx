import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/review._index";
import { requireRole } from "../auth/authorize.server";
import { AppShell } from "../components/app-header";
import { EmptyState, PageHeader, Section } from "../components/ui";
import { StatusBadge } from "../components/workflow-ui";
import { getRequestScope } from "../server/request-scope.server";
import { listReviewQueue, type ListItem } from "../submissions/queries.server";
import { formatCampus } from "../submissions/time";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Review queue · Vshow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["REVIEWER"]);
  const queue = await listReviewQueue(scope.database.get(), user);
  return { roles: user.roles, ...queue };
}

function Table({ items, empty, label }: { items: ListItem[]; empty: string; label: string }) {
  const navigate = useNavigate();
  if (items.length === 0) return <EmptyState title={empty} />;
  const showSubmitted = items.some((s) => s.status === "PENDING_REVIEW");
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="vtable">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Committee</th>
            <th scope="col">Submitted by</th>
            <th scope="col">Status</th>
            {showSubmitted && <th scope="col">Submitted</th>}
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="cursor-pointer" onClick={() => navigate(`/review/${s.id}`)}>
              <td className="max-w-80 font-medium">
                <Link className="link" to={`/review/${s.id}`} onClick={(e) => e.stopPropagation()}>
                  {s.title}
                </Link>
              </td>
              <td className="text-dim">{s.committeeName}</td>
              <td className="text-dim">{s.createdByName}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              {showSubmitted && (
                <td className="tabular whitespace-nowrap text-dim">
                  {s.submittedAt ? formatCampus(s.submittedAt) : "—"}
                </td>
              )}
              <td className="tabular whitespace-nowrap text-dim">{formatCampus(s.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReviewQueue({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell roles={loaderData.roles}>
      <PageHeader
        eyebrow="Corporate Communication"
        title="Review queue"
        description="Submissions waiting for a decision, oldest first. Drafts are never shown."
      />
      <div className="space-y-14">
        <Section id="pending" title={`Pending (${loaderData.pending.length})`}>
          <Table items={loaderData.pending} empty="Nothing is waiting for review." label="Pending submissions" />
        </Section>
        <Section id="decided" title="Recently decided">
          <Table items={loaderData.decided} empty="No decided submissions yet." label="Recently decided submissions" />
        </Section>
      </div>
    </AppShell>
  );
}
