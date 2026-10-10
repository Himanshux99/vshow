// Server-entry behaviour that does NOT depend on the hosting runtime. Every runtime-specific
// `entry.server` (Node streams today; Web streams on Cloudflare) re-exports or calls these, so request
// IDs, request logging and error logging behave identically wherever the app runs. Only the HTML
// rendering itself lives in entry.server.tsx. Uses Web-standard APIs only (no Node built-ins).
import { isRouteErrorResponse, type HandleErrorFunction, type RouterContextProvider } from "react-router";
import { getContainer } from "./container.server.ts";
import { createRequestInstrumentation, logUnscopedRequest } from "./instrumentation.server.ts";
import { REQUEST_ID_HEADER, appContext, resolveRequestId } from "./request-scope.server.ts";

/** Logs requests the root middleware never sees (`.data` calls, failures before routing). */
export const instrumentations = [createRequestInstrumentation(getContainer)];

/**
 * A document request the root middleware never saw (an unmatched route) gets a request ID in the response
 * header and exactly one log line. A no-op for requests the middleware already handled.
 */
export function handleUnscopedDocument(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  loadContext: RouterContextProvider,
): void {
  if (loadContext.get(appContext)) return;
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  responseHeaders.set(REQUEST_ID_HEADER, requestId);
  logUnscopedRequest(getContainer().logger, { request, status: responseStatusCode, requestId });
}

/** Logs an error that happened while streaming HTML after the shell was sent. */
export function logStreamingError(loadContext: RouterContextProvider, error: unknown): void {
  const logger = loadContext.get(appContext)?.logger ?? getContainer().logger;
  logger.error("streaming render error", { err: error });
}

// Called by React Router for every unhandled error in loaders, actions and rendering. The error is logged
// here with its request ID; the response sent to the browser is generic (see ErrorBoundary in root.tsx).
export const handleError: HandleErrorFunction = (error, { request, context }) => {
  if (request.signal.aborted) return; // the client went away; not a server fault
  const logger = context.get(appContext)?.logger ?? getContainer().logger;
  // 4xx responses (404 etc.) are expected outcomes, not server faults; the request summary already records them.
  if (isRouteErrorResponse(error) && error.status < 500) {
    logger.debug("request ended with an error response", { status: error.status, path: new URL(request.url).pathname });
    return;
  }
  logger.error("unhandled request error", {
    method: request.method,
    path: new URL(request.url).pathname,
    err: error,
  });
};
