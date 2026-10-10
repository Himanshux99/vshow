import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { WORKFLOW_STATUSES, sqlList } from "./values";
import { appUser } from "./identity";
import { committee, screen } from "./campus";

// Schema doc §4.7
export const submission = pgTable(
  "submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceCode: varchar("reference_code", { length: 40 }).notNull().unique(),
    committeeId: uuid("committee_id")
      .notNull()
      .references(() => committee.id),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    workflowStatus: text("workflow_status").notNull(),
    currentVersionId: uuid("current_version_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("submission_workflow_status_valid", sql.raw(`"workflow_status" IN (${sqlList(WORKFLOW_STATUSES)})`)),
    // Composite FK (schema doc §4.7 / §8): current version must belong to this submission.
    // Not enforced while current_version_id is NULL (MATCH SIMPLE).
    foreignKey({
      name: "submission_current_version_fk",
      columns: [t.currentVersionId, t.id],
      foreignColumns: [mediaVersion.id, mediaVersion.submissionId],
    }),
    index("submission_status_updated_idx").on(t.workflowStatus, t.updatedAt.desc()),
    index("submission_committee_created_idx").on(t.committeeId, t.createdAt.desc()),
    index("submission_creator_created_idx").on(t.createdByUserId, t.createdAt.desc()),
  ],
);

// Schema doc §4.8 (immutable: rows are inserted, never updated)
export const mediaVersion = pgTable(
  "media_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Annotated to break the submission <-> media_version type cycle (current_version_id).
    submissionId: uuid("submission_id")
      .notNull()
      .references((): AnyPgColumn => submission.id),
    versionNumber: integer("version_number").notNull(),
    objectKey: varchar("object_key", { length: 1024 }).notNull().unique(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 150 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => appUser.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    changeNote: text("change_note"),
  },
  (t) => [
    unique("media_version_submission_number_unique").on(t.submissionId, t.versionNumber),
    // Target for composite FKs that must prove "version belongs to submission".
    unique("media_version_id_submission_unique").on(t.id, t.submissionId),
    check("media_version_size_positive", sql`${t.sizeBytes} > 0`),
    check("media_version_number_positive", sql`${t.versionNumber} >= 1`),
    index("media_version_submission_number_idx").on(t.submissionId, t.versionNumber.desc()),
  ],
);

// Schema doc §4.9. slot_number distinguishes several requested windows on the same
// screen (schema doc §9, decision 2).
export const screenRequest = pgTable(
  "screen_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submission.id),
    screenId: uuid("screen_id")
      .notNull()
      .references(() => screen.id),
    slotNumber: integer("slot_number").notNull().default(1),
    preferredStartAt: timestamp("preferred_start_at", { withTimezone: true }),
    preferredEndAt: timestamp("preferred_end_at", { withTimezone: true }),
    requestNote: text("request_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("screen_request_submission_screen_slot_unique").on(t.submissionId, t.screenId, t.slotNumber),
    check("screen_request_slot_positive", sql`${t.slotNumber} >= 1`),
    check(
      "screen_request_window_valid",
      sql`${t.preferredStartAt} IS NULL OR ${t.preferredEndAt} IS NULL OR ${t.preferredEndAt} > ${t.preferredStartAt}`,
    ),
    index("screen_request_screen_window_idx").on(t.screenId, t.preferredStartAt, t.preferredEndAt),
  ],
);
