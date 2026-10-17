// How Better Auth's four models map onto Vshow's tables. Shared by the Better Auth configuration and by
// tests/auth-schema.test.ts, which checks this mapping against Better Auth's own table definitions.
//
// Verified against better-auth / @better-auth/drizzle-adapter 1.6.23:
//  - the adapter finds a table with `schema[modelName]`, and the default model names are
//    user / session / account / verification, so those are the keys below;
//  - fields are addressed by the Drizzle table's JS property names, so only `name` needs a mapping
//    (Better Auth's `name` is Vshow's `displayName`); every other property keeps Better Auth's name;
//  - a field missing from a table makes the adapter throw rather than silently dropping data.
import { appUser, authAccount, authSession, authVerification } from "../db/schema/identity.ts";

export const authSchema = {
  user: appUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
} as const;

/** Better Auth option overrides needed for the mapping (`user.fields`). */
export const authModelOptions = {
  user: { fields: { name: "displayName" } },
} as const;
