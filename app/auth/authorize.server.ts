// Server-side authentication + authorization helpers. THIS is where access is decided, on every request, from
// the database: the session cookie only proves who is asking, never what they may do. Nothing is cached
// (Better Auth's cookie cache is off), so role revocation, membership changes and deactivation apply at once.
//
// Rules, all deny-by-default:
//  - no valid session, or an inactive/missing user  -> not signed in
//  - signed in but holding no role at all           -> "unassigned" (sent to /unclaimed); never a default role
//  - guards are ALLOWLISTS of roles: pass the roles that may act; an empty list denies everyone
//  - identity-provider claims are never consulted here; roles come only from Vshow's own tables
import { and, eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import { ApiError } from "../server/api-response.server.ts";
import type { RequestScope } from "../server/request-scope.server.ts";
import { appRole, appUser, authSession, userRole } from "../db/schema/identity.ts";
import { committee, committeeMembership } from "../db/schema/campus.ts";
import { ROLE_CODES, type MembershipType, type RoleCode } from "../db/schema/values.ts";
import { AuthConfigError, SESSION_POLICY } from "./config.server.ts";

export interface Membership {
  committeeId: string;
  committeeCode: string;
  membershipType: MembershipType;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  roles: RoleCode[];
  /** Only ACTIVE memberships of ACTIVE committees. */
  memberships: Membership[];
}

export type Access =
  | { status: "anonymous" }
  | { status: "inactive" }
  | { status: "unassigned"; user: CurrentUser }
  | { status: "ok"; user: CurrentUser };

type Scope = Pick<RequestScope, "auth" | "database" | "logger">;

/** Resolves who is asking and what they hold, from the database. Never throws for "not signed in". */
export async function resolveAccess(scope: Scope, headers: Headers, now: Date = new Date()): Promise<Access> {
  const session = await scope.auth.get().api.getSession({ headers });
  if (!session) return { status: "anonymous" };

  const db = scope.database.get();

  // Defense in depth for the 30-day absolute lifetime (also enforced by a database trigger on refresh).
  const age = now.getTime() - new Date(session.session.createdAt).getTime();
  if (age > SESSION_POLICY.absoluteMaxAge * 1000) {
    await db.delete(authSession).where(eq(authSession.id, session.session.id));
    return { status: "anonymous" };
  }

  const [row] = await db
    .select({ id: appUser.id, email: appUser.email, displayName: appUser.displayName, isActive: appUser.isActive })
    .from(appUser)
    .where(eq(appUser.id, session.user.id))
    .limit(1);
  if (!row) return { status: "anonymous" };
  if (!row.isActive) {
    await db.delete(authSession).where(eq(authSession.userId, row.id));
    return { status: "inactive" };
  }

  const roleRows = await db
    .select({ code: appRole.code })
    .from(userRole)
    .innerJoin(appRole, eq(appRole.id, userRole.roleId))
    .where(eq(userRole.userId, row.id));
  const roles = roleRows.map((r) => r.code).filter((c): c is RoleCode => (ROLE_CODES as readonly string[]).includes(c));

  const membershipRows = await db
    .select({
      committeeId: committeeMembership.committeeId,
      committeeCode: committee.code,
      membershipType: committeeMembership.membershipType,
    })
    .from(committeeMembership)
    .innerJoin(committee, eq(committee.id, committeeMembership.committeeId))
    .where(
      and(eq(committeeMembership.userId, row.id), eq(committeeMembership.isActive, true), eq(committee.isActive, true)),
    );

  const user: CurrentUser = {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    roles,
    memberships: membershipRows as Membership[],
  };
  return roles.length === 0 ? { status: "unassigned", user } : { status: "ok", user };
}

export const hasAnyRole = (user: CurrentUser, allowed: readonly RoleCode[]) =>
  allowed.length > 0 && allowed.some((role) => user.roles.includes(role));

/**
 * A convener may act for a committee only with the CONVENER role AND an active membership in THAT committee
 * (schema doc §4.5/§6). The role alone is never enough, and membership alone is never enough.
 */
export const canActForCommittee = (user: CurrentUser, committeeId: string) =>
  user.roles.includes("CONVENER") && user.memberships.some((m) => m.committeeId === committeeId);

// --- unavailable authentication ----------------------------------------------------------------------------------

/** Fixed text for the 503 response. It never names a variable, a value or an exception. */
export const AUTH_UNAVAILABLE_MESSAGE = "Authentication is currently unavailable.";

/**
 * Authentication is "unavailable" when its CONFIGURATION is missing or invalid (e.g. no vauth client credentials
 * yet): that is a temporary 503, not a server bug. The reason is logged (variable names only, never values); the
 * response is fixed. Only AuthConfigError is treated this way: every other exception (a database failure, a
 * programming error) keeps propagating as the unexpected error it is. Access is never granted by this path.
 */
export function authUnavailable(scope: Pick<RequestScope, "logger">, err: AuthConfigError): never {
  scope.logger.error("authentication is not configured correctly", { reason: err.message });
  throw data(AUTH_UNAVAILABLE_MESSAGE, { status: 503, statusText: "Service Unavailable" });
}

async function resolveAccessForPage(scope: Scope, headers: Headers): Promise<Access> {
  try {
    return await resolveAccess(scope, headers);
  } catch (err) {
    if (err instanceof AuthConfigError) authUnavailable(scope, err);
    throw err;
  }
}

async function resolveAccessForApi(scope: Scope, headers: Headers): Promise<Access> {
  try {
    return await resolveAccess(scope, headers);
  } catch (err) {
    if (err instanceof AuthConfigError) {
      scope.logger.error("authentication is not configured correctly", { reason: err.message });
      throw new ApiError(503);
    }
    throw err;
  }
}

// --- guards for PAGE routes: redirect or throw a 403 response ------------------------------------------------

function assertAllowlist(allowed: readonly RoleCode[]) {
  if (allowed.length === 0)
    throw new Error("A route guard needs at least one allowed role (an empty list would deny everyone).");
}

/** The user must be signed in and hold at least one of `allowed`. Anonymous -> /login, unassigned -> /unclaimed. */
export async function requireRole(scope: Scope, request: Request, allowed: readonly RoleCode[]): Promise<CurrentUser> {
  assertAllowlist(allowed);
  const access = await resolveAccessForPage(scope, request.headers);
  if (access.status === "anonymous") throw redirect("/login");
  if (access.status === "inactive") throw redirect("/login?error=inactive");
  if (access.status === "unassigned") throw redirect("/unclaimed");
  if (!hasAnyRole(access.user, allowed)) {
    scope.logger.warn("access denied: missing role", { userId: access.user.id, path: new URL(request.url).pathname });
    throw data(null, { status: 403 });
  }
  return access.user;
}

/** Any signed-in user with at least one role (no particular role needed). */
export const requireAssignedUser = (scope: Scope, request: Request) => requireRole(scope, request, ROLE_CODES);

/** For /unclaimed: a signed-in user with NO role. Anyone else is sent where they belong. */
export async function requireUnassigned(scope: Scope, request: Request): Promise<CurrentUser> {
  const access = await resolveAccessForPage(scope, request.headers);
  if (access.status === "anonymous") throw redirect("/login");
  if (access.status === "inactive") throw redirect("/login?error=inactive");
  if (access.status === "ok") throw redirect("/me");
  return access.user;
}

// --- guards for API / resource routes: safe JSON errors ---------------------------------------------------------

export async function requireApiRole(
  scope: Scope,
  request: Request,
  allowed: readonly RoleCode[],
): Promise<CurrentUser> {
  assertAllowlist(allowed);
  const access = await resolveAccessForApi(scope, request.headers);
  if (access.status === "anonymous" || access.status === "inactive") throw new ApiError(401);
  if (access.status === "unassigned" || !hasAnyRole(access.user, allowed)) throw new ApiError(403);
  return access.user;
}

// --- request hygiene ---------------------------------------------------------------------------------------

/**
 * Same CSRF defence when the configured origin is unavailable: the Origin header's host must be the host this request
 * was addressed to (browsers set both, and a cross-site page cannot make them match). Scheme is not compared, because
 * behind a TLS-terminating proxy the app can see `http` while the browser sent `https`.
 */
export function assertSameHost(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw data(null, { status: 403 }); // e.g. the literal "null" origin
  }
  if (originHost !== new URL(request.url).host) throw data(null, { status: 403 });
}

/**
 * CSRF defence for state-changing form posts: if the browser sent an Origin header it must be ours. (Cookies are
 * SameSite=Lax, which already blocks cross-site POSTs; this is the second layer.)
 */
export function assertSameOrigin(request: Request, baseURL: string): void {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== baseURL) throw data(null, { status: 403 });
}
