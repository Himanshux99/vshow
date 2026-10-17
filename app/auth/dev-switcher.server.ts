// Local development identity switcher. This module only DEFINES the plugin; it is registered by buildAuth()
// solely when resolveDevAuth() returned enabled (every guard passed at startup). When disabled the endpoint
// does not exist at all, so there is nothing to attack in production.
//
// It is not a second authentication system: it creates an ordinary Better Auth session (same table, same
// cookie, same policy hooks, so deactivated users are still refused) for one of a FIXED set of seeded test
// identities. The browser can only name a key from that set; it can never supply a user ID, an email or a role.
// Roles and memberships are still read from the database on every request by the normal authorization layer.
import { createAuthEndpoint, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.server.ts";
import { appUser } from "../db/schema/identity.ts";
import type { Logger } from "../logging/logger.server.ts";
import { SEED_EMAIL_DOMAIN } from "./config.server.ts";

/**
 * The only identities the switcher can become. Keys mirror scripts/seed/fixtures.ts; the email is derived
 * server-side as `<key>@seed.vshow.invalid`, and the row must also carry a `seed-<key>` subject.
 */
export const DEV_IDENTITY_KEYS = [
  "admin",
  "reviewer",
  "manager",
  "convener_media",
  "convener_robotics",
  "convener_lapsed",
  "member_media",
  "inactive_convener",
] as const;

export type DevIdentityKey = (typeof DEV_IDENTITY_KEYS)[number];

export const devIdentitySchema = z.object({ identity: z.enum(DEV_IDENTITY_KEYS) });

export interface DevSwitcherDeps {
  getDb: () => Db;
  logger: Logger;
}

export const DEV_SIGN_IN_PATH = "/dev/sign-in";

export function devSwitcherPlugin({ getDb, logger }: DevSwitcherDeps): BetterAuthPlugin {
  return {
    id: "vshow-dev-switcher",
    endpoints: {
      devSignIn: createAuthEndpoint(DEV_SIGN_IN_PATH, { method: "POST", body: devIdentitySchema }, async (ctx) => {
        // Better Auth's own origin check is skipped for requests without cookies, which is exactly the
        // cross-site login-CSRF case. A browser always sends Origin on cross-origin POSTs, so require it to match.
        const origin = ctx.headers?.get("origin");
        if (origin && origin !== new URL(ctx.context.baseURL).origin) {
          throw new APIError("FORBIDDEN", { message: "Cross-origin request refused." });
        }
        const key = ctx.body.identity;
        const email = `${key}@${SEED_EMAIL_DOMAIN}`;

        // Resolve from the database, and require BOTH seed markers: the reserved `.invalid` email and the
        // `seed-<key>` subject. A real user can never satisfy either.
        const rows = await getDb()
          .select({ id: appUser.id, isActive: appUser.isActive, subject: appUser.vauthSubject })
          .from(appUser)
          .where(and(eq(appUser.email, email), like(appUser.vauthSubject, "seed-%")))
          .limit(1);
        const row = rows[0];
        if (!row || row.subject !== `seed-${key}`) {
          throw new APIError("NOT_FOUND", { message: "Unknown development identity. Run `npm run db:seed`." });
        }
        if (!row.isActive) throw new APIError("FORBIDDEN", { message: "This development identity is deactivated." });

        const user = await ctx.context.internalAdapter.findUserById(row.id);
        // createSession runs the same databaseHooks.session.create.before as a real sign-in.
        const session = user ? await ctx.context.internalAdapter.createSession(user.id) : null;
        if (!user || !session) throw new APIError("FORBIDDEN", { message: "Session could not be created." });

        await setSessionCookie(ctx, { session, user });
        logger.info("development identity session created", { identity: key });
        return ctx.json({ ok: true, identity: key });
      }),
    },
  };
}
