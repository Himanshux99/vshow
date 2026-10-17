import { Form, Link } from "react-router";

/** Top navigation shown on the workflow pages. Links are shown by role; the server enforces access on every route. */
export function AppHeader({ roles }: { roles: readonly string[] }) {
  const link = "text-sm underline-offset-2 hover:underline";
  return (
    <header className="border-b bg-gray-50 dark:bg-gray-900">
      <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 px-6 py-3">
        <Link to="/me" className="font-semibold">
          Vshow
        </Link>
        {roles.includes("CONVENER") && (
          <Link to="/submissions" className={link}>
            My submissions
          </Link>
        )}
        {roles.includes("REVIEWER") && (
          <Link to="/review" className={link}>
            Review queue
          </Link>
        )}
        <Form method="post" action="/logout" className="ml-auto">
          <button type="submit" className="text-sm underline-offset-2 hover:underline">
            Sign out
          </button>
        </Form>
      </nav>
    </header>
  );
}
