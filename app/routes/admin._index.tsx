import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/admin._index";
import { listUsers, type AdminUserListItem } from "../admin/users.server";
import { requireRole } from "../auth/authorize.server";
import { AppShell } from "../components/app-header";
import { EmptyState, PageHeader, Section } from "../components/ui";
import { getRequestScope } from "../server/request-scope.server";
import { ROLE_LABEL } from "../auth/landing";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Users · Vshow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["ADMIN"]);
  const users = await listUsers(scope.database.get());
  return { roles: user.roles, users };
}

function UserTable({ users, label }: { users: AdminUserListItem[]; label: string }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="vtable">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Roles</th>
            <th scope="col">Committees</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="cursor-pointer" onClick={() => navigate(`/admin/${u.id}`)}>
              <td className="max-w-80 font-medium">
                <Link className="link" to={`/admin/${u.id}`} onClick={(e) => e.stopPropagation()}>
                  {u.displayName}
                </Link>
                {!u.isActive && <span className="ml-2 text-xs text-dim">(inactive)</span>}
              </td>
              <td className="break-all text-dim">{u.email}</td>
              <td className="text-dim">{u.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ") || "—"}</td>
              <td className="tabular text-dim">{u.committees}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const waiting = loaderData.users.filter((u) => u.roles.length === 0 && u.isActive);
  const assigned = loaderData.users.filter((u) => u.roles.length > 0 || !u.isActive);
  return (
    <AppShell roles={loaderData.roles}>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="New sign-ups have no role until you assign one. Open a person to give them a role and add them to committees."
      />
      <div className="space-y-14">
        <Section id="waiting" title={`Waiting for a role (${waiting.length})`}>
          {waiting.length === 0 ? (
            <EmptyState title="No one is waiting for a role." />
          ) : (
            <UserTable users={waiting} label="Users without a role" />
          )}
        </Section>
        <Section id="users" title={`Everyone else (${assigned.length})`}>
          {assigned.length === 0 ? (
            <EmptyState title="No other users yet." />
          ) : (
            <UserTable users={assigned} label="Users with roles" />
          )}
        </Section>
      </div>
    </AppShell>
  );
}
