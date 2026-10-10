import { sql } from "drizzle-orm";
import { boolean, check, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { ROLE_CODES, sqlList } from "./values";

// Schema doc §4.1
export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    vauthSubject: varchar("vauth_subject", { length: 255 }).unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
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
  (t) => [check("app_role_code_valid", sql.raw(`"code" IN (${sqlList(ROLE_CODES)})`))],
);

// Schema doc §4.3
export const userRole = pgTable(
  "user_role",
  {
    userId: uuid("user_id").notNull().references(() => appUser.id),
    roleId: uuid("role_id").notNull().references(() => appRole.id),
    assignedByUserId: uuid("assigned_by_user_id").references((): AnyPgColumn => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);
