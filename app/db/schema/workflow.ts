import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { REVIEW_DECISIONS, SCHEDULE_STATUSES, sqlList } from "./values";
import { appUser } from "./identity";
import { screen } from "./campus";
import { mediaVersion, submission } from "./submissions";

// Schema doc §4.10 (append-only)
export const reviewDecision = pgTable(
  "review_decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull().references(() => submission.id),
    mediaVersionId: uuid("media_version_id").notNull(),
    reviewerUserId: uuid("reviewer_user_id").notNull().references(() => appUser.id),
    decision: text("decision").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The reviewed version must belong to the same submission.
    foreignKey({
      name: "review_decision_version_fk",
      columns: [t.mediaVersionId, t.submissionId],
      foreignColumns: [mediaVersion.id, mediaVersion.submissionId],
    }),
    check("review_decision_decision_valid", sql.raw(`"decision" IN (${sqlList(REVIEW_DECISIONS)})`)),
    check(
      "review_decision_changes_need_comment",
      sql`${t.decision} <> 'CHANGES_REQUESTED' OR (${t.comment} IS NOT NULL AND btrim(${t.comment}) <> '')`,
    ),
    index("review_decision_submission_created_idx").on(t.submissionId, t.createdAt.desc()),
    index("review_decision_version_created_idx").on(t.mediaVersionId, t.createdAt.desc()),
  ],
);

// Schema doc §4.11 (manager's actual schedule, separate from screen_request)
export const scheduleEntry = pgTable(
  "schedule_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull().references(() => submission.id),
    mediaVersionId: uuid("media_version_id").notNull(),
    screenId: uuid("screen_id").notNull().references(() => screen.id),
    status: text("status").notNull(),
    actualStartAt: timestamp("actual_start_at", { withTimezone: true }),
    actualEndAt: timestamp("actual_end_at", { withTimezone: true }),
    externalScheduleRef: varchar("external_schedule_ref", { length: 255 }),
    managerNote: text("manager_note"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => appUser.id),
    updatedByUserId: uuid("updated_by_user_id").notNull().references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: "schedule_entry_version_fk",
      columns: [t.mediaVersionId, t.submissionId],
      foreignColumns: [mediaVersion.id, mediaVersion.submissionId],
    }),
    check("schedule_entry_status_valid", sql.raw(`"status" IN (${sqlList(SCHEDULE_STATUSES)})`)),
    check(
      "schedule_entry_window_valid",
      sql`${t.actualStartAt} IS NULL OR ${t.actualEndAt} IS NULL OR ${t.actualEndAt} > ${t.actualStartAt}`,
    ),
    index("schedule_entry_screen_status_start_idx").on(t.screenId, t.status, t.actualStartAt),
    index("schedule_entry_submission_created_idx").on(t.submissionId, t.createdAt.desc()),
  ],
);

// Schema doc §4.12 (append-only; never store tokens, signed URLs or secrets in metadata)
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    submissionId: uuid("submission_id").references(() => submission.id),
    metadata: jsonb("metadata"),
    ipHash: varchar("ip_hash", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_event_submission_created_idx").on(t.submissionId, t.createdAt.desc()),
    index("audit_event_actor_created_idx").on(t.actorUserId, t.createdAt.desc()),
  ],
);
