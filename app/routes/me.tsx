import { Link } from "react-router";
import type { Route } from "./+types/me";
import { requireAssignedUser } from "../auth/authorize.server";
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

const ROLE_LABEL: Record<string, string> = {
  CONVENER: "Committee convener",
  REVIEWER: "Corporate Communication reviewer",
  SERVER_ROOM_MANAGER: "Server Room Manager",
  ADMIN: "Administrator",
};

export default function Me({ loaderData }: Route.ComponentProps) {
  const { roles, committees } = loaderData;
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
        {roles.includes("CONVENER") || roles.includes("REVIEWER") ? (
          <div className="rows">
            {roles.includes("CONVENER") && (
              <Link to="/submissions" className="row-item hover-row group">
                <span className="step-num pt-1.5">01</span>
                <span>
                  <span className="block text-2xl font-semibold tracking-tight group-hover:text-brand">
                    My submissions <span aria-hidden="true">→</span>
                  </span>
                  <span className="mt-1 block text-dim">Create drafts, upload media, and track review decisions.</span>
                </span>
              </Link>
            )}
            {roles.includes("REVIEWER") && (
              <Link to="/review" className="row-item hover-row group">
                <span className="step-num pt-1.5">{roles.includes("CONVENER") ? "02" : "01"}</span>
                <span>
                  <span className="block text-2xl font-semibold tracking-tight group-hover:text-brand">
                    Review queue <span aria-hidden="true">→</span>
                  </span>
                  <span className="mt-1 block text-dim">
                    Approve, reject, or request changes on pending submissions.
                  </span>
                </span>
              </Link>
            )}
          </div>
        ) : (
          <Notice tone="info">
            Your roles don’t have a page in this release yet. Manager and administrator tools arrive in a later phase.
          </Notice>
        )}
      </div>
    </AppShell>
  );
}
