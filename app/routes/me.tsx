import { Link } from "react-router";
import type { Route } from "./+types/me";
import { requireAssignedUser } from "../auth/authorize.server";
import { ROLE_LABEL } from "../auth/landing";
import { AppShell } from "../components/app-header";
import { MetadataList, Notice, PageHeader } from "../components/ui";
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

// One entry per role that has a page, in the same order as the header navigation.
const DESTINATIONS = [
  {
    role: "CONVENER",
    to: "/submissions",
    title: "My submissions",
    text: "Create drafts, upload media, and track review decisions.",
  },
  {
    role: "REVIEWER",
    to: "/review",
    title: "Review queue",
    text: "Approve, reject, or request changes on pending submissions.",
  },
  {
    role: "SERVER_ROOM_MANAGER",
    to: "/manager",
    title: "Server room",
    text: "See approved media to put on the screens and mark it done.",
  },
  { role: "ADMIN", to: "/admin", title: "Users", text: "Assign roles and committee memberships to people." },
];

export default function Me({ loaderData }: Route.ComponentProps) {
  const { roles, committees } = loaderData;
  const destinations = DESTINATIONS.filter((d) => (roles as readonly string[]).includes(d.role));
  return (
    <AppShell roles={roles}>
      <PageHeader
        eyebrow="Your account"
        title={loaderData.displayName}
        description={<span className="break-all">{loaderData.email}</span>}
      />

      <MetadataList
        items={[
          {
            label: "Roles",
            value: roles.length ? (
              <ul className="m-0 list-none p-0">
                {roles.map((r) => (
                  <li key={r}>{ROLE_LABEL[r] ?? r}</li>
                ))}
              </ul>
            ) : (
              "None"
            ),
          },
          {
            label: "Committees",
            value: committees.length ? (
              <ul className="m-0 list-none p-0">
                {committees.map((c) => (
                  <li key={c.code}>
                    {c.code} <span className="mono text-xs text-dim">{c.type}</span>
                  </li>
                ))}
              </ul>
            ) : (
              "None"
            ),
          },
        ]}
      />

      <div className="mt-12">
        <p className="eyebrow mb-4">Where to next</p>
        {destinations.length ? (
          <div className="rows">
            {destinations.map((d, i) => (
              <Link key={d.to} to={d.to} className="row-item hover-row group">
                <span className="step-num pt-1.5">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block text-2xl font-semibold tracking-tight group-hover:text-brand">
                    {d.title} <span aria-hidden="true">→</span>
                  </span>
                  <span className="mt-1 block text-dim">{d.text}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Notice tone="info">You don’t have a role with a page yet. An administrator can assign one.</Notice>
        )}
      </div>
    </AppShell>
  );
}
