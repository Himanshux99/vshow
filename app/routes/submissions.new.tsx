import { Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/submissions.new";
import { assertSameOrigin, requireRole } from "../auth/authorize.server";
import { AppHeader } from "../components/app-header";
import { ErrorNotice } from "../components/workflow-ui";
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
  const field = "mt-1 block w-full rounded border px-2 py-1.5";
  return (
    <>
      <AppHeader roles={roles} />
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold">New submission</h1>
        <p className="mt-1 text-sm text-gray-600">
          You will add the media, screens and display windows on the next page. Nothing is sent for review until you
          submit it.
        </p>
        {committees.length === 0 ? (
          <p className="mt-6 text-sm">You are not an active member of any committee that can submit media.</p>
        ) : (
          <Form method="post" className="mt-6 space-y-4">
            <ErrorNotice error={failure?.error} />
            <label className="block text-sm">
              Committee
              <select
                name="committeeId"
                required
                className={field}
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
            </label>
            <label className="block text-sm">
              Title
              <input name="title" required maxLength={200} className={field} />
            </label>
            <label className="block text-sm">
              Description (optional)
              <textarea name="description" rows={4} maxLength={5000} className={field} />
            </label>
            <button type="submit" className="rounded bg-black px-4 py-2 text-white">
              Create draft
            </button>
          </Form>
        )}
      </main>
    </>
  );
}
