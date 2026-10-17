import { Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/submissions.new";
import { assertSameOrigin, requireRole } from "../auth/authorize.server";
import { AppShell } from "../components/app-header";
import { Notice, PageHeader } from "../components/ui";
import { ErrorNotice, SubmitButton } from "../components/workflow-ui";
import { getRequestScope } from "../server/request-scope.server";
import { actionFailure, type ActionFailure } from "../submissions/http.server";
import { createDraft, listManageableCommittees } from "../submissions/submissions.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "New submission · Vshow" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["CONVENER"]);
  return { roles: user.roles, committees: await listManageableCommittees(scope, user) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["CONVENER"]);
  assertSameOrigin(request, scope.auth.config().baseURL);
  const form = await request.formData();
  try {
    const created = await createDraft(scope, user, {
      committeeId: form.get("committeeId"),
      title: form.get("title"),
      description: form.get("description") ?? "",
    });
    return redirect(`/submissions/${created.id}`);
  } catch (e) {
    return actionFailure(e);
  }
}

export default function NewSubmission({ loaderData }: Route.ComponentProps) {
  const failure = useActionData<ActionFailure>();
  const { committees, roles } = loaderData;
  return (
    <AppShell roles={roles} narrow>
      <PageHeader
        back={{ to: "/submissions", label: "my submissions" }}
        breadcrumb={
          <>
            <Link to="/submissions" className="link-quiet">
              My submissions
            </Link>{" "}
            / New
          </>
        }
        title="New submission"
        description="You’ll add the media, screens and display windows on the next page. Nothing is sent for review until you submit it."
      />
      {committees.length === 0 ? (
        <Notice tone="warn" title="No committee available">
          You are not an active member of any committee that can submit media.
        </Notice>
      ) : (
        <Form method="post" className="space-y-6">
          <ErrorNotice error={failure?.error} />
          <div>
            <label htmlFor="committeeId" className="label">
              Committee
            </label>
            <select
              id="committeeId"
              name="committeeId"
              required
              className="field"
              defaultValue={committees.length === 1 ? committees[0].id : ""}
            >
              <option value="" disabled>
                Choose a committee…
              </option>
              {committees.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="title" className="label">
              Title
            </label>
            <input id="title" name="title" required maxLength={200} className="field" />
            <p className="hint">Up to 200 characters. Reviewers see this exact title.</p>
          </div>
          <div>
            <label htmlFor="description" className="label">
              Description (optional)
            </label>
            <textarea id="description" name="description" rows={4} maxLength={5000} className="field" />
            <p className="hint">Up to 5,000 characters.</p>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <SubmitButton pending="Creating draft…">Create draft</SubmitButton>
            <Link to="/submissions" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </Form>
      )}
    </AppShell>
  );
}
