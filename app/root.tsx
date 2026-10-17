import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import { PublicHeader } from "./components/app-header";
import { getContainer } from "./server/container.server";
import { createRequestScopeMiddleware } from "./server/request-scope.server";
import "./app.css";

// Server-only: assigns a request ID, builds the request-scoped logger and exposes dependencies to
// loaders/actions through router context. React Router strips this export from the client bundle.
export const middleware: Route.MiddlewareFunction[] = [createRequestScopeMiddleware(getContainer)];

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600&display=swap",
  },
];

// Runs before first paint so the saved (or OS) theme never flashes. A stored choice wins over the OS preference.
// Storage can throw (private mode, blocked site data): the page then simply follows the OS preference.
const THEME_INIT = `(function(){try{var t=null;try{t=localStorage.getItem('voss-theme')}catch(e){}
if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark')}}catch(e){}})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <Meta />
        <Links />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Error";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = String(error.status);
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.status === 403
          ? "Your account doesn’t have access to this page."
          : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <>
      <PublicHeader />
      <main id="main" tabIndex={-1} className="container-voss page">
        <div className="page-narrow">
          <p className="eyebrow eyebrow-brand">{message}</p>
          <h1 className="page-title mt-3">
            {message === "404" ? "Page not found" : message === "403" ? "Access denied" : "Something went wrong"}
          </h1>
          <p className="lede mt-4">{details}</p>
          <div className="mt-8">
            <Link to="/" className="btn btn-ghost">
              Back to home
            </Link>
          </div>
          {stack && (
            <pre className="panel mono mt-8 overflow-x-auto text-xs">
              <code>{stack}</code>
            </pre>
          )}
        </div>
      </main>
    </>
  );
}
