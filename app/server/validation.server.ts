// Request validation at route boundaries, using shared Zod schemas. Failures become ApiError, so
// `toApiResponse` returns a safe 4xx and never echoes the submitted data.
//
//   const input = await parseJsonBody(request, createThingSchema);   // throws ApiError(400|413|415|422)
//   const query = parseSearchParams(request, listQuerySchema);       // throws ApiError(422)
//
// Schemas live next to the feature (and can be imported by the client for form validation: Zod itself is
// browser-safe; only this boundary file is server-only).
import type { z } from "zod";
import { ApiError, issuesFromZod } from "./api-response.server.ts";

export const MAX_JSON_BODY_BYTES = 1_000_000;

async function readTextLimited(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413);
  if (!request.body) return "";

  // Count bytes as they arrive so an oversized or lying Content-Length cannot make us buffer everything.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ApiError(413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  { maxBytes = MAX_JSON_BODY_BYTES }: { maxBytes?: number } = {},
): Promise<z.infer<S>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/(.+\+)?json\b/i.test(contentType)) throw new ApiError(415);

  const text = await readTextLimited(request, maxBytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Deliberately no detail: the parser's message can quote part of the body.
    throw new ApiError(400, { code: "invalid_json", message: "The request body is not valid JSON." });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(422, { issues: issuesFromZod(result.error), cause: result.error });
  return result.data;
}

/** Validates the query string. Repeated keys become arrays; values are never echoed in errors. */
export function parseSearchParams<S extends z.ZodType>(request: Pick<Request, "url">, schema: S): z.infer<S> {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(422, { code: "invalid_query", issues: issuesFromZod(result.error), cause: result.error });
  }
  return result.data;
}
