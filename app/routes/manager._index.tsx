import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/manager._index";
import { requireRole } from "../auth/authorize.server";
import { AppShell } from "../components/app-header";
import { EmptyState, PageHeader, Section } from "../components/ui";
import { getRequestScope } from "../server/request-scope.server";
import { listManagerQueue, type ManagerListItem } from "../submissions/manager.server";
import { formatCampus } from "../submissions/time";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Server room · Vshow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["SERVER_ROOM_MANAGER"]);
  const queue = await listManagerQueue(scope.database.get(), user);
  return { roles: user.roles, ...queue };
}

function Table({
  items,
  empty,
  label,
  done,
}: {
  items: ManagerListItem[];
  empty: string;
  label: string;
  done: boolean;
}) {
  const navigate = useNavigate();
  if (items.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="vtable">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Committee</th>
            <th scope="col">Submitted by</th>
            <th scope="col">{done ? "Done" : "Approved"}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="cursor-pointer" onClick={() => navigate(`/manager/${s.id}`)}>
              <td className="max-w-80 font-medium">
                <Link className="link" to={`/manager/${s.id}`} onClick={(e) => e.stopPropagation()}>
                  {s.title}
                </Link>
              </td>
              <td className="text-dim">{s.committeeName}</td>
              <td className="text-dim">{s.createdByName}</td>
              <td className="tabular whitespace-nowrap text-dim">
                {formatCampus(done ? (s.doneAt ?? s.updatedAt) : s.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ManagerQueue({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell roles={loaderData.roles}>
      <PageHeader
        eyebrow="Server room"
        title="Approved media"
        description="Approved submissions to download and put on the screens. Mark each one done when it is live."
      />
      <div className="space-y-14">
        <Section id="todo" title={`To do (${loaderData.todo.length})`}>
          <Table
            items={loaderData.todo}
            empty="Nothing is waiting to be put on screens."
            label="Approved submissions to do"
            done={false}
          />
        </Section>
        <Section id="done" title={`Done (${loaderData.done.length})`}>
          <Table items={loaderData.done} empty="Nothing has been marked done yet." label="Completed submissions" done />
        </Section>
      </div>
    </AppShell>
  );
}
