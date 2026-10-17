import { Form, Link, data, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/submissions.$id";
import { assertSameOrigin, requireRole } from "../auth/authorize.server";
import { AppHeader } from "../components/app-header";
import { UploadPanel } from "../components/upload-panel";
import { WindowsEditor } from "../components/windows-editor";
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
import { getSubmissionForConvener, listActiveScreens } from "../submissions/queries.server";
import { saveDraft, submitForReview } from "../submissions/submissions.server";
import { formatCampus } from "../submissions/time";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Submission · Vshow" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["CONVENER"]);
  const db = scope.database.get();
  try {
    const submission = await getSubmissionForConvener(db, user, params.id);
    return {
      roles: user.roles,
      submission,
      screens: await listActiveScreens(db),
      limits: { maxBytes: scope.media.maxBytes, maxWindows: scope.media.maxWindows },
      storageReady: scope.storage.configured,
    };
  } catch (e) {
    return loaderFailure(e);
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["CONVENER"]);
  assertSameOrigin(request, scope.auth.config().baseURL);
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "save") {
      let windows: unknown = [];
      try {
        windows = JSON.parse(String(form.get("windows") ?? "[]"));
      } catch {
        throw data(
          { ok: false, error: { code: "validation_failed", message: "The windows could not be read.", issues: [] } },
          { status: 422 },
        );
      }
      const result = await saveDraft(scope, user, params.id, {
        title: form.get("title"),
        description: form.get("description") ?? "",
        windows,
      });
      return { ok: true as const, saved: result.changed, withdrawn: result.approvalInvalidated };
    }
    if (intent === "submit") {
      await submitForReview(scope, user, params.id);
      return { ok: true as const, submitted: true };
    }
    throw data(null, { status: 400 });
  } catch (e) {
    return actionFailure(e);
  }
}

type ActionResult = ActionFailure | { ok: true; saved?: boolean; withdrawn?: boolean; submitted?: boolean };

export default function SubmissionPage({ loaderData }: Route.ComponentProps) {
  const { submission: s, screens, limits, roles, storageReady } = loaderData;
  const result = useActionData<ActionResult>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const feedback = s.decisions.find((d) => d.comment && (s.status === "CHANGES_REQUESTED" || s.status === "REJECTED"));
  const field = "mt-1 block w-full rounded border px-2 py-1.5";

  return (
    <>
      <AppHeader roles={roles} />
      <main className="mx-auto max-w-4xl space-y-8 p-6">
        <header>
          <p className="text-sm text-gray-600">
            <Link to="/submissions" className="underline">
              My submissions
            </Link>{" "}
            / {s.referenceCode}
          </p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{s.title}</h1>
            <StatusBadge status={s.status} />
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {s.committee.name} · created by {s.createdByName} · {formatCampus(s.createdAt)}
          </p>
          {s.resubmissionOf && (
            <p className="mt-1 text-sm">
              A resubmission of{" "}
              <Link className="underline" to={`/submissions/${s.resubmissionOf.id}`}>
                {s.resubmissionOf.referenceCode}
              </Link>
              . It has its own media and review history.
            </p>
          )}
          {s.resubmittedAs.length > 0 && (
            <p className="mt-1 text-sm">
              Resubmitted as{" "}
              {s.resubmittedAs.map((r) => (
                <Link key={r.id} className="mr-2 underline" to={`/submissions/${r.id}`}>
                  {r.referenceCode}
                </Link>
              ))}
            </p>
          )}
        </header>

        {result && result.ok === false && <ErrorNotice error={result.error} />}
        {result && result.ok && result.submitted && (
          <p role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm">
            Submitted for review. You can’t edit it while it is being reviewed.
          </p>
        )}
        {result && result.ok && result.saved === false && (
          <p role="status" className="text-sm">
            Nothing had changed.
          </p>
        )}
        {result && result.ok && result.withdrawn && (
          <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            This submission was approved. Your change withdrew that approval: submit it again for a fresh review.
          </p>
        )}

        {feedback && (
          <section className="rounded border border-amber-300 bg-amber-50 p-4">
            <h2 className="font-medium">
              {s.status === "REJECTED" ? "Why it was rejected" : "Changes requested"} — {feedback.reviewerName}
            </h2>
            <p className="mt-1 whitespace-pre-wrap text-sm">{feedback.comment}</p>
            {s.status === "REJECTED" && (
              <p className="mt-2 text-sm">
                A rejected submission is closed and can’t be edited. A new, linked application can be started from it
                later.
              </p>
            )}
          </section>
        )}

        {s.status === "PENDING_REVIEW" && (
          <p className="rounded border border-blue-300 bg-blue-50 p-3 text-sm">
            This submission is waiting for Corporate Communication. It can’t be edited while it is pending.
          </p>
        )}
        {s.status === "APPROVED" && (
          <p className="rounded border border-green-300 bg-green-50 p-3 text-sm">
            Approved. Changing the title, description, windows or media withdraws the approval and needs a new review.
          </p>
        )}

        <section>
          <h2 className="text-lg font-medium">Details and display windows</h2>
          {s.canEdit ? (
            <Form method="post" className="mt-3 space-y-4">
              <input type="hidden" name="intent" value="save" />
              <label className="block text-sm">
                Title
                <input name="title" required maxLength={200} defaultValue={s.title} className={field} />
              </label>
              <label className="block text-sm">
                Description
                <textarea
                  name="description"
                  rows={4}
                  maxLength={5000}
                  defaultValue={s.description ?? ""}
                  className={field}
                />
              </label>
              <WindowsEditor screens={screens} initial={s.windows} maxWindows={limits.maxWindows} />
              <button type="submit" disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50">
                Save changes
              </button>
            </Form>
          ) : (
            <div className="mt-3 space-y-3">
              {s.description && <p className="whitespace-pre-wrap text-sm">{s.description}</p>}
              <WindowsTable windows={s.windows} />
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-medium">Media</h2>
          <div className="mt-3 space-y-4">
            <VersionList submissionId={s.id} versions={s.versions} />
            {s.canEdit &&
              (storageReady ? (
                <UploadPanel submissionId={s.id} maxBytes={limits.maxBytes} disabled={busy} />
              ) : (
                <p className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">
                  Media storage is not available right now, so new media can’t be uploaded.
                </p>
              ))}
          </div>
        </section>

        {s.canSubmit && (
          <section>
            <h2 className="text-lg font-medium">Send for review</h2>
            <p className="mt-1 text-sm text-gray-600">
              Needs uploaded media and at least one display window starting in the future. Save your changes first.
            </p>
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="submit" />
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Submit for review
              </button>
            </Form>
          </section>
        )}

        <section>
          <h2 className="text-lg font-medium">Review history</h2>
          <div className="mt-3 space-y-4">
            <DecisionList decisions={s.decisions} />
            {s.revisions.length > 0 && (
              <ul className="space-y-1 text-sm">
                {s.revisions.map((r) => (
                  <li key={r.id}>
                    Revision {r.revisionNumber} — “{r.title}”, {r.windows.length} window
                    {r.windows.length === 1 ? "" : "s"}, {formatCampus(r.createdAt)}
                    {r.isCurrent ? " (current)" : ""}
                  </li>
                ))}
              </ul>
            )}
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
