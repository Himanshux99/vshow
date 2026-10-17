// Covers requests that never reach the root middleware (mainly unmatched routes) so they still get a request
// ID and one safe summary log line. Each kind of request has exactly ONE owner, so nothing is logged twice
// and a request never has two different IDs:
//   - matched routes          -> the root middleware (request-scope.server.ts)
//   - unmatched documents     -> `handleRequest` in entry.server.tsx (it can also set the response header)
//   - unmatched `.data` calls, and failures before routing -> the instrumentation below
// The instrumentation API is read-only, so it can log but cannot add response headers.
import type { ServerInstrumentation } from "react-router";
import type { Logger } from "../logging/logger.server.ts";
import type { AppDeps } from "./container.server.ts";
import { REQUEST_ID_HEADER, appContext, resolveRequestId } from "./request-scope.server.ts";

/** Only the read-only parts of a request that logging needs (React Router's instrumentation passes a read-only view). */
export interface LoggableRequest {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
}

export interface UnscopedRequestInfo {
  request: LoggableRequest;
  status?: number;
  durationMs?: number;
  requestId?: string;
  err?: unknown;
}

/** Logs a request that did not pass through the middleware. Path only: never the query string. */
export function logUnscopedRequest(
  logger: Logger,
  { request, status, durationMs, requestId, err }: UnscopedRequestInfo,
) {
  const scoped = logger.child({ requestId: requestId ?? resolveRequestId(request.headers.get(REQUEST_ID_HEADER)) });
  const fields = {
    method: request.method,
    path: new URL(request.url).pathname,
    matched: false,
    ...(status !== undefined ? { status } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
  if (err !== undefined) scoped.error("request failed before routing", { ...fields, err });
  else if (status !== undefined && status >= 500) scoped.error("request completed", fields);
  else scoped.info("request completed", fields);
}

/** React Router's single-fetch data requests end in `.data` and never reach `handleRequest`. */
export function isDataRequest(request: { url: string }): boolean {
  return new URL(request.url).pathname.endsWith(".data");
}

export function createRequestInstrumentation(
  getDeps: () => AppDeps,
  now: () => number = () => performance.now(),
): ServerInstrumentation {
  return {
    handler(handler) {
      handler.instrument({
        async request(handleRequest, { request, context }) {
          const started = now();
          const result = await handleRequest();
          if (context?.get(appContext)) return; // the middleware ran and has already logged this request

          const durationMs = Math.round((now() - started) * 100) / 100;
          if (result.status === "error") {
            logUnscopedRequest(getDeps().logger, { request, durationMs, err: result.error });
          } else if (isDataRequest(request)) {
            logUnscopedRequest(getDeps().logger, { request, durationMs, status: result.statusCode });
          }
          // Unmatched documents are logged by `handleRequest` in entry.server.tsx.
        },
      });
    },
  };
}
