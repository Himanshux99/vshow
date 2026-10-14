// Clearing Vshow's auth cookies WITHOUT Better Auth. Used only when authentication is unavailable (its
// configuration is missing or invalid) and a normal sign-out cannot run. It contacts nothing, touches no
// database and never involves vauth: it just tells the browser to drop the cookies. The names mirror
// Better Auth's (`<prefix>.<name>`, with `__Secure-` in front on https); tests/auth-flow.test.ts proves every
// cookie a real sign-in sets is covered, so this list cannot silently drift.
import { COOKIE_PREFIX } from "./config.server.ts";

export const AUTH_COOKIE_NAMES = ["session_token", "session_data", "dont_remember", "state"] as const;

/** `Set-Cookie` header values that expire every Vshow auth cookie, in both its plain and `__Secure-` forms. */
export function expiredAuthCookies(): string[] {
  const plain = AUTH_COOKIE_NAMES.map((n) => `${COOKIE_PREFIX}.${n}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  const secure = AUTH_COOKIE_NAMES.map(
    (n) => `__Secure-${COOKIE_PREFIX}.${n}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
  );
  return [...plain, ...secure];
}
