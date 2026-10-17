// GET /submissions/:id/versions/:versionId/file — authorizes, then redirects to a short-lived signed download URL.
//  - a convener of the submission's committee may download any version of it;
//  - a reviewer may download only versions that were actually submitted for review (never drafts).
// The signed URL is only ever sent in the Location header of this response: `no-store`, `no-referrer`, never logged.
import { data, redirect } from "react-router";
import type { Route } from "./+types/submissions.$id.versions.$versionId.file";
import { requireRole } from "../auth/authorize.server";
import { getRequestScope } from "../server/request-scope.server";
import { loaderFailure } from "../submissions/http.server";
import { WorkflowError } from "../submissions/errors";
import { createMediaDownloadUrl } from "../submissions/uploads.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const scope = getRequestScope(context);
  const user = await requireRole(scope, request, ["CONVENER", "REVIEWER"]);
  const capacities = (["convener", "reviewer"] as const).filter((as) =>
    as === "convener" ? user.roles.includes("CONVENER") : user.roles.includes("REVIEWER"),
  );
  let failure: unknown;
  for (const as of capacities) {
    try {
      const url = await createMediaDownloadUrl(scope, user, params.id, params.versionId, { as });
      return redirect(url, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    } catch (e) {
      // "not found" in one capacity may still be allowed in the other; any other failure is final.
      if (e instanceof WorkflowError && e.code === "not_found") failure = e;
      else return loaderFailure(e);
    }
  }
  if (failure) return loaderFailure(failure);
  throw data(null, { status: 404 });
}
