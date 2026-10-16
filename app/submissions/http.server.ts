// Glue between the workflow services and React Router: turns the services' expected failures (WorkflowError) into
// either a page action result (a form shows the message) or the standard safe JSON error (resource routes).
// Unexpected errors are never handled here: they keep propagating to the error handling that logs them.
import { data } from "react-router";
import { assertSameOrigin } from "../auth/authorize.server.ts";
import { ApiError } from "../server/api-response.server.ts";
import { WorkflowError, type FieldIssue } from "./errors.ts";

export interface ActionFailure {
  ok: false;
  error: { code: string; message: string; issues: FieldIssue[] };
}

export const failureBody = (e: WorkflowError): ActionFailure => ({
  ok: false,
  error: { code: e.code, message: e.message, issues: e.issues },
});

/** For page actions: a WorkflowError becomes a returned (not thrown) result with its status; anything else rethrows. */
export function actionFailure(e: unknown) {
  if (e instanceof WorkflowError) return data(failureBody(e), { status: e.status });
  throw e;
}

/** For resource (JSON) routes: a WorkflowError becomes an ApiError; anything else is returned unchanged to rethrow. */
export function asApiError(e: unknown): unknown {
  if (e instanceof WorkflowError) {
    return new ApiError(e.status, { code: e.code, message: e.message, issues: e.issues });
  }
  return e;
}

/** A WorkflowError thrown from a loader becomes a plain status response (404 page, 403, 503...). */
export function loaderFailure(e: unknown): never {
  if (e instanceof WorkflowError) throw data(null, { status: e.status });
  throw e;
}

/**
 * The CSRF origin check for JSON routes: a mismatch is a plain 403 in the standard API error shape. (The page-route
 * helper throws a React Router response, which `toApiResponse` would not recognise.)
 */
export function assertApiSameOrigin(request: Request, baseURL: string): void {
  try {
    assertSameOrigin(request, baseURL);
  } catch {
    throw new ApiError(403);
  }
}
