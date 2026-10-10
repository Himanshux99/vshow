import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { MEMBERSHIP_TYPES, sqlList } from "./values";
import { appUser } from "./identity";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// Schema doc §4.4
export const committee = pgTable("committee", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 80 }).notNull().unique(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Schema doc §4.5
export const committeeMembership = pgTable(
  "committee_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    committeeId: uuid("committee_id")
      .notNull()
      .references(() => committee.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    membershipType: text("membership_type").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    assignedByUserId: uuid("assigned_by_user_id").references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("committee_membership_committee_user_unique").on(t.committeeId, t.userId),
    check("committee_membership_type_valid", sql.raw(`"membership_type" IN (${sqlList(MEMBERSHIP_TYPES)})`)),
  ],
);

// Schema doc §4.6
export const screen = pgTable("screen", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  code: varchar("code", { length: 80 }).notNull().unique(),
  locationDescription: text("location_description"),
  isActive: boolean("is_active").notNull().default(true),
  externalPlayerRef: varchar("external_player_ref", { length: 255 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
