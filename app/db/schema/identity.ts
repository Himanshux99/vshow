import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { ROLE_CODES, sqlList } from "./values.ts";

// Schema doc §4.1
export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    vauthSubject: varchar("vauth_subject", { length: 255 }).unique(),
    isActive: boolean("is_active").notNull().default(true),
    // Better Auth user fields. `emailVerified` is set from the verified vauth claim; `image` is unused and
    // exists only because Better Auth's user model includes it.
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("app_user_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`)],
);

// Schema doc §4.2
export const appRole = pgTable(
  "app_role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("app_role_code_valid", sql.raw(`"code" IN (${sqlList(ROLE_CODES)})`))],
);

// Schema doc §4.3
export const userRole = pgTable(
  "user_role",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => appRole.id),
    assignedByUserId: uuid("assigned_by_user_id").references((): AnyPgColumn => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

// ---------------------------------------------------------------------------------------------------------
// Authentication persistence (Better Auth 1.6.23). `app_user` above is Better Auth's user model; these three
// tables are its session, account and verification models. Property names must match Better Auth's field
// names (tests/auth-schema.test.ts proves it against Better Auth's own table definitions). Sessions and
// accounts cascade with the user only because they hold no application data; every application table keeps
// its restrictive foreign keys.
// ---------------------------------------------------------------------------------------------------------

export const authSession = pgTable(
  "auth_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Not collected: Vshow nulls both (privacy). The columns exist because Better Auth writes the fields.
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // createdAt anchors the absolute session lifetime; it is never changed by sliding refreshes.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The provider's stable subject: the OIDC `sub` for provider `voss`. */
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    // OAuth tokens are NEVER stored (schema doc §3). The columns exist because Better Auth writes the
    // fields; a CHECK constraint makes any attempt to persist a value fail the sign-in instead.
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("auth_account_provider_account_unique").on(t.providerId, t.accountId),
    unique("auth_account_user_provider_unique").on(t.userId, t.providerId),
    check(
      "auth_account_no_secrets",
      sql`${t.accessToken} IS NULL AND ${t.refreshToken} IS NULL AND ${t.idToken} IS NULL AND ${t.password} IS NULL AND ${t.accessTokenExpiresAt} IS NULL AND ${t.refreshTokenExpiresAt} IS NULL`,
    ),
    index("auth_account_user_idx").on(t.userId),
  ],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);
