// One consistent, safe JSON shape for API / resource routes. Page routes do NOT use this: they keep React
// Router's own mechanisms (thrown responses, route ErrorBoundary, `handleError` for logging).
//
//   success: { "data": ... }                                            (status 2xx)
//   failure: { "error": { "code", "message", "requestId"?, "issues"? } } (status 4xx/5xx)
//
// Rules:
//  - Only text written by us (ApiError messages) or generic text is ever sent. Unknown errors become a
//    generic 500 with the request ID; the real error is logged server-side and never returned.
//  - Validation issues contain a field path and a machine code, never the submitted value.
//  - Nothing here retries anything. Retrying a write without an idempotency strategy can duplicate it, so
//    callers decide, and only with an explicit idempotency key (none exists yet).
import { ZodError } from "zod";
import type { Logger } from "../logging/logger.server.ts";
import { REQUEST_ID_HEADER } from "./request-scope.server.ts";

export interface ApiIssue {
  /** Dot-separated field path, e.g. "screens.0.slot". */
  path: string;
  /** Machine-readable reason, e.g. "too_small", "invalid_type". */
  code: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; issues?: ApiIssue[] };
}

const DEFAULT_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "validation_failed",
  429: "rate_limited",
  500: "internal_error",
  503: "service_unavailable",
};

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "The request could not be understood.",
  401: "Authentication is required.",
  403: "You do not have permission to do this.",
  404: "The requested resource was not found.",
  405: "This method is not allowed.",
  409: "The request conflicts with the current state.",
  413: "The request body is too large.",
  415: "Unsupported content type.",
  422: "The request failed validation.",
  429: "Too many requests.",
  500: "An unexpected error occurred.",
  503: "The service is temporarily unavailable.",
};

/** An error whose status and message are safe to show to the client. Everything else is treated as internal. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: ApiIssue[];

  constructor(status: number, options: { code?: string; message?: string; issues?: ApiIssue[]; cause?: unknown } = {}) {
    super(options.message ?? DEFAULT_MESSAGES[status] ?? "Request failed.", { cause: options.cause });
    this.name = "ApiError";
    this.status = status;
    this.code = options.code ?? DEFAULT_CODES[status] ?? "error";
    this.issues = options.issues;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export function apiJson<T>(data: T, init: { status?: number; headers?: HeadersInit } = {}): Response {
  return new Response(JSON.stringify({ data }), {
    status: init.status ?? 200,
    headers: { ...JSON_HEADERS, ...Object.fromEntries(new Headers(init.headers)) },
  });
}

export function apiErrorResponse(error: ApiError, requestId?: string): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(requestId ? { requestId } : {}),
      ...(error.issues?.length ? { issues: error.issues } : {}),
    },
  };
  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: { ...JSON_HEADERS, ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}) },
  });
}

/** Zod issues reduced to path + code. The submitted values (and Zod's free-text messages) are dropped. */
export function issuesFromZod(error: ZodError): ApiIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
  }));
}

/**
 * Turns anything thrown inside an API route into a safe response. Use it in a `catch` block of a resource
 * route's loader/action. Page routes should NOT: let those errors reach the route's ErrorBoundary.
 *  - a thrown Response (redirect etc.) is returned unchanged
 *  - ApiError / ZodError -> their status with a safe body (4xx are expected, so logged at info)
 *  - anything else -> logged in full server-side, generic 500 to the client
 */
export function toApiResponse(error: unknown, scope: { logger: Logger; requestId: string }): Response {
  if (error instanceof Response) return error;
  if (error instanceof ZodError) {
    error = new ApiError(422, { issues: issuesFromZod(error), cause: error });
  }
  if (error instanceof ApiError) {
    scope.logger.info("api request rejected", { status: error.status, code: error.code });
    return apiErrorResponse(error, scope.requestId);
  }
  scope.logger.error("api request failed", { err: error });
  return apiErrorResponse(new ApiError(500), scope.requestId);
}
