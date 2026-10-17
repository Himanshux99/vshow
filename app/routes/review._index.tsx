import { Link } from "react-router";
import type { Route } from "./+types/review._index";
import { requireRole } from "../auth/authorize.server";
import { AppHeader } from "../components/app-header";
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

function Table({ items, empty }: { items: ListItem[]; empty: string }) {
  if (items.length === 0) return <p className="mt-3 text-sm text-gray-600">{empty}</p>;
  return (
    <table className="mt-3 w-full text-left text-sm">
      <thead>
        <tr className="border-b">
          <th className="py-2 pr-3">Reference</th>
          <th className="py-2 pr-3">Title</th>
          <th className="py-2 pr-3">Committee</th>
          <th className="py-2 pr-3">Submitted by</th>
          <th className="py-2 pr-3">Status</th>
          <th className="py-2">{items[0]?.status === "PENDING_REVIEW" ? "Submitted" : "Updated"}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.id} className="border-b">
            <td className="py-2 pr-3">
              <Link className="underline" to={`/review/${s.id}`}>
                {s.referenceCode}
              </Link>
            </td>
            <td className="py-2 pr-3">{s.title}</td>
            <td className="py-2 pr-3">{s.committeeName}</td>
            <td className="py-2 pr-3">{s.createdByName}</td>
            <td className="py-2 pr-3">
              <StatusBadge status={s.status} />
            </td>
            <td className="py-2">
              {formatCampus(s.status === "PENDING_REVIEW" ? (s.submittedAt ?? s.updatedAt) : s.updatedAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReviewQueue({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <AppHeader roles={loaderData.roles} />
      <main className="mx-auto max-w-4xl space-y-10 p-6">
        <section>
          <h1 className="text-2xl font-semibold">Review queue</h1>
          <p className="text-sm text-gray-600">
            Submissions waiting for a decision, oldest first. Drafts are never shown.
          </p>
          <Table items={loaderData.pending} empty="Nothing is waiting for review." />
        </section>
        <section>
          <h2 className="text-lg font-medium">Recently decided</h2>
          <Table items={loaderData.decided} empty="No decided submissions yet." />
        </section>
      </main>
    </>
  );
}
