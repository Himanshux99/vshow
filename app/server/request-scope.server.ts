// Per-request wiring for React Router's server middleware: assigns a request ID, builds a request-scoped
// logger, exposes dependencies to loaders/actions through typed router context, and logs one summary line
// per request. Server-only.
//
// What is logged per request: method, path (no query string), status, duration, request ID.
// Never logged: headers, cookies, query strings, request/response bodies, IP addresses, user agents.
import { createContext, type MiddlewareFunction, type RouterContextProvider } from "react-router";
import type { AppDeps } from "./container.server.ts";
import type { Logger } from "../logging/logger.server.ts";

export const REQUEST_ID_HEADER = "x-request-id";

/** What loaders and actions receive: the shared dependencies plus request-specific values. */
export interface RequestScope extends AppDeps {
  requestId: string;
  /** Child of the app logger that stamps every record with `requestId`. */
  logger: Logger;
}

export const appContext = createContext<RequestScope | null>(null);

/** Reads the scope set by the middleware. Throws if the middleware did not run (a wiring bug). */
export function getRequestScope(context: Readonly<RouterContextProvider>): RequestScope {
  const scope = context.get(appContext);
  if (!scope) throw new Error("Request scope is missing: is requestScopeMiddleware exported from the root route?");
  return scope;
}

// Accept a caller-supplied ID (for tracing across proxies) only if it is short and boring; otherwise
// it could be used to forge or flood logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function resolveRequestId(
  incoming: string | null | undefined,
  generate: () => string = () => crypto.randomUUID(),
): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : generate();
}

export interface RequestScopeOptions {
  /** Monotonic clock in milliseconds. Injectable for deterministic tests. */
  now?: () => number;
  generateId?: () => string;
}

export function createRequestScopeMiddleware(
  getDeps: () => AppDeps,
  { now = () => performance.now(), generateId }: RequestScopeOptions = {},
): MiddlewareFunction<Response> {
  return async ({ request, context }, next) => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER), generateId);
    const deps = getDeps();
    const logger = deps.logger.child({ requestId });
    context.set(appContext, { ...deps, logger, requestId });

    const path = new URL(request.url).pathname;
    const started = now();
    let response: Response;
    try {
      response = await next();
    } catch (err) {
      if (err instanceof Response) {
        response = err; // a thrown redirect/response is control flow, not a failure
      } else {
        logger.error("request failed", { method: request.method, path, durationMs: elapsed(started, now), err });
        throw err;
      }
    }

    response = withRequestId(response, requestId);
    const fields = { method: request.method, path, status: response.status, durationMs: elapsed(started, now) };
    if (response.status >= 500) logger.error("request completed", fields);
    else logger.info("request completed", fields);
    return response;
  };
}

function elapsed(started: number, now: () => number): number {
  return Math.round((now() - started) * 100) / 100;
}

function withRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    // Some responses have immutable headers; rebuild without touching the body.
    const copy = new Response(response.body, response);
    copy.headers.set(REQUEST_ID_HEADER, requestId);
    return copy;
  }
}
