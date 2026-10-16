// POST /submissions/:id/upload/finalize — step 3 of a media upload: copy the staged object to its final key, validate
// what is there (size, declared type, file signature) and record it as the next immutable media version, all
// atomically. Safe to repeat for the same reservation.
import { z } from "zod";
import type { Route } from "./+types/submissions.$id.upload.finalize";
import { requireApiRole } from "../auth/authorize.server";
import { apiJson, toApiResponse } from "../server/api-response.server";
import { getRequestScope } from "../server/request-scope.server";
import { parseJsonBody } from "../server/validation.server";
import { asApiError, assertApiSameOrigin } from "../submissions/http.server";
import { finalizeUpload } from "../submissions/uploads.server";

const finalizeSchema = z.object({ reservationId: z.uuid() });

export async function action({ request, context, params }: Route.ActionArgs) {
  const scope = getRequestScope(context);
  try {
    const user = await requireApiRole(scope, request, ["CONVENER"]);
    assertApiSameOrigin(request, scope.auth.config().baseURL);
    const body = await parseJsonBody(request, finalizeSchema);
    const out = await finalizeUpload(scope, user, params.id, body.reservationId);
    return apiJson(out, { status: out.alreadyFinalized ? 200 : 201 });
  } catch (e) {
    return toApiResponse(asApiError(e), scope);
  }
}

export function loader() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
