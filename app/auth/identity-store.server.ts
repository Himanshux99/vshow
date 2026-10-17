// Database operations behind the vauth identity policy. Kept small and explicit so each can be tested against
// a real (disposable) database. Nothing here creates users or roles: users are created only by Better Auth's
// sign-in transaction, and roles only by an administrator.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.server.ts";
import { appUser, authAccount, authSession } from "../db/schema/identity.ts";
import { VAUTH } from "./config.server.ts";

export interface LinkedUser {
  id: string;
  email: string;
  isActive: boolean;
}

export type EmailChangeResult = "updated" | "conflict";

export interface IdentityStore {
  /** The local user already linked to this vauth subject, if any. */
  findUserBySubject(sub: string): Promise<LinkedUser | null>;
  /** Moves a linked user to a new, already-validated email. `conflict` if another user owns that email. */
  changeEmail(userId: string, email: string): Promise<EmailChangeResult>;
  /** Ends every Vshow session of a user. */
  revokeSessions(userId: string): Promise<void>;
}

const UNIQUE_VIOLATION = "23505";

export function createIdentityStore(getDb: () => Db): IdentityStore {
  return {
    async findUserBySubject(sub) {
      const rows = await getDb()
        .select({ id: appUser.id, email: appUser.email, isActive: appUser.isActive })
        .from(authAccount)
        .innerJoin(appUser, eq(appUser.id, authAccount.userId))
        .where(and(eq(authAccount.providerId, VAUTH.providerId), eq(authAccount.accountId, sub)))
        .limit(1);
      return rows[0] ?? null;
    },

    async changeEmail(userId, email) {
      try {
        await getDb()
          .update(appUser)
          .set({ email, emailVerified: true, updatedAt: sql`now()` })
          .where(eq(appUser.id, userId));
        return "updated";
      } catch (err) {
        // The unique constraint on app_user.email is the arbiter: never overwrite or merge another user.
        const code =
          (err as { code?: string; cause?: { code?: string } }).code ??
          (err as { cause?: { code?: string } }).cause?.code;
        if (code === UNIQUE_VIOLATION) return "conflict";
        throw err;
      }
    },

    async revokeSessions(userId) {
      await getDb().delete(authSession).where(eq(authSession.userId, userId));
    },
  };
}
