/** True if `value` is a React Router `redirect()` response pointing at `location`. */
export function isRedirectResponse(value: unknown, location: string): boolean {
  return (
    value instanceof Response && value.status >= 300 && value.status < 400 && value.headers.get("location") === location
  );
}
