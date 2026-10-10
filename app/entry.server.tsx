import { PassThrough } from "node:stream";

import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router";
import { isRouteErrorResponse } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";

import { getContainer } from "./server/container.server";
import { appContext } from "./server/request-scope.server";

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
      [readyOption]() {
        shellRendered = true;
        const body = new PassThrough({
          final(callback) {
            // Clear the timeout to prevent retaining the closure and memory leak
            clearTimeout(timeoutId);
            timeoutId = undefined;
            callback();
          },
        });
        const stream = createReadableStreamFromReadable(body);

        responseHeaders.set("Content-Type", "text/html");

        pipe(body);

        resolve(
          new Response(stream, {
            headers: responseHeaders,
            status: responseStatusCode,
          }),
        );
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          const logger = loadContext.get(appContext)?.logger ?? getContainer().logger;
          logger.error("streaming render error", { err: error });
        }
      },
    });
  });
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
