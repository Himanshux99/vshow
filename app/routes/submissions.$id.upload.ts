// POST /submissions/:id/upload — step 1 of a media upload: authorize, reserve, return a short-lived upload URL for a
// staging object. JSON in, JSON out. The response contains a signed URL, so it is never cached (apiJson sets
// no-store) and is never logged.
import type { Route } from "./+types/submissions.$id.upload";
import { requireApiRole } from "../auth/authorize.server";
import { apiJson, toApiResponse } from "../server/api-response.server";
import { getRequestScope } from "../server/request-scope.server";
import { parseJsonBody } from "../server/validation.server";
import { asApiError, assertApiSameOrigin } from "../submissions/http.server";
import { uploadInitSchema } from "../submissions/schemas";
import { initUpload } from "../submissions/uploads.server";

export async function action({ request, context, params }: Route.ActionArgs) {
  const scope = getRequestScope(context);
  try {
    const user = await requireApiRole(scope, request, ["CONVENER"]);
    assertApiSameOrigin(request, scope.auth.config().baseURL);
    const body = await parseJsonBody(request, uploadInitSchema);
    const out = await initUpload(scope, user, params.id, body);
    return apiJson(
      {
        reservationId: out.reservationId,
        upload: {
          url: out.upload.url,
          method: out.upload.method,
          headers: out.upload.headers,
          expiresAt: out.upload.expiresAt.toISOString(),
        },
        maxBytes: out.maxBytes,
      },
      { status: 201 },
    );
  } catch (e) {
    return toApiResponse(asApiError(e), scope);
  }
}

// Only POST is supported.
export function loader() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
