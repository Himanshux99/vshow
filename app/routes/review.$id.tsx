import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/review.$id";
import { assertSameOrigin, requireRole } from "../auth/authorize.server";
import { AppHeader } from "../components/app-header";
import {
  AuditList,
  DecisionList,
  ErrorNotice,
  StatusBadge,
  VersionList,
  WindowsTable,
} from "../components/workflow-ui";
import { getRequestScope } from "../server/request-scope.server";
import { actionFailure, loaderFailure, type ActionFailure } from "../submissions/http.server";
import { getSubmissionForReviewer } from "../submissions/queries.server";
import { decide } from "../submissions/reviews.server";
import { formatCampus } from "../submissions/time";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Review · Vshow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["REVIEWER"]);
  try {
    return { roles: user.roles, submission: await getSubmissionForReviewer(scope.database.get(), user, params.id) };
  } catch (e) {
    return loaderFailure(e);
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["REVIEWER"]);
  assertSameOrigin(request, scope.auth.config().baseURL);
  const form = await request.formData();
  try {
    await decide(scope, user, params.id, {
      revisionId: form.get("revisionId"),
      decision: form.get("decision"),
      comment: form.get("comment") ?? undefined,
    });
    return redirect("/review");
  } catch (e) {
    if (e instanceof Response) throw e;
    return actionFailure(e);
  }
}

export default function ReviewPage({ loaderData }: Route.ComponentProps) {
  const { submission: s, roles } = loaderData;
  const failure = useActionData<ActionFailure>();
  const busy = useNavigation().state !== "idle";
  const rev = s.currentRevision;
  return (
    <>
      <AppHeader roles={roles} />
      <main className="mx-auto max-w-4xl space-y-8 p-6">
        <header>
          <p className="text-sm text-gray-600">
            <Link to="/review" className="underline">
              Review queue
            </Link>{" "}
            / {s.referenceCode}
          </p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{rev?.title ?? s.title}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {s.committee.name} · submitted by {s.createdByName}
            {s.submittedAt ? ` · ${formatCampus(s.submittedAt)}` : ""}
          </p>
          {s.resubmissionOf && (
            <p className="mt-1 text-sm">
              A resubmission of{" "}
              <Link className="underline" to={`/review/${s.resubmissionOf.id}`}>
                {s.resubmissionOf.referenceCode}
              </Link>{" "}
              (a previously rejected application). It starts with no approval of its own.
            </p>
          )}
        </header>

        {rev ? (
          <section>
            <h2 className="text-lg font-medium">
              Revision {rev.revisionNumber} {s.status === "PENDING_REVIEW" ? "— up for review" : "— latest"}
            </h2>
            <p className="text-sm text-gray-600">This is exactly what a decision applies to.</p>
            {rev.description && <p className="mt-3 whitespace-pre-wrap text-sm">{rev.description}</p>}
            <div className="mt-4">
              <h3 className="text-sm font-medium">Requested display windows</h3>
              <WindowsTable windows={rev.windows} />
            </div>
            <div className="mt-4">
              <h3 className="text-sm font-medium">Media</h3>
              <VersionList submissionId={s.id} versions={s.versions.filter((v) => v.id === rev.mediaVersionId)} />
            </div>
          </section>
        ) : (
          <p className="text-sm">No revision has been submitted.</p>
        )}

        {s.canDecide && rev ? (
          <section className="rounded border p-4">
            <h2 className="text-lg font-medium">Your decision</h2>
            <ErrorNotice error={failure?.error} />
            <Form method="post" className="mt-3 space-y-3">
              <input type="hidden" name="revisionId" value={rev.id} />
              <fieldset className="space-y-1 text-sm">
                <legend className="sr-only">Decision</legend>
                <label className="block">
                  <input type="radio" name="decision" value="APPROVED" required /> Approve this revision
                </label>
                <label className="block">
                  <input type="radio" name="decision" value="CHANGES_REQUESTED" /> Request changes (comment required)
                </label>
                <label className="block">
                  <input type="radio" name="decision" value="REJECTED" /> Reject (reason required)
                </label>
              </fieldset>
              <label className="block text-sm">
                Comment or reason
                <textarea
                  name="comment"
                  rows={4}
                  maxLength={2000}
                  className="mt-1 block w-full rounded border px-2 py-1.5"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Record decision
              </button>
            </Form>
          </section>
        ) : (
          s.status === "PENDING_REVIEW" && (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              You can’t decide on a submission you created. Another reviewer must review it.
            </p>
          )
        )}

        <section>
          <h2 className="text-lg font-medium">Earlier revisions and decisions</h2>
          <div className="mt-3 space-y-4">
            <DecisionList decisions={s.decisions} />
            <ul className="space-y-1 text-sm">
              {s.revisions
                .filter((r) => !r.isCurrent)
                .map((r) => (
                  <li key={r.id}>
                    Revision {r.revisionNumber} — “{r.title}”, {r.windows.length} window
                    {r.windows.length === 1 ? "" : "s"}, {formatCampus(r.createdAt)}
                  </li>
                ))}
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-medium">Activity</h2>
          <div className="mt-3">
            <AuditList events={s.audit} />
          </div>
        </section>
      </main>
    </>
  );
}
