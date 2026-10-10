// Allowed values for status/role columns. Stored as text with CHECK constraints
// (not PostgreSQL enums) so values can be extended with a plain migration.

export const ROLE_CODES = ["CONVENER", "REVIEWER", "SERVER_ROOM_MANAGER", "ADMIN"] as const;
export const MEMBERSHIP_TYPES = ["CONVENER", "MEMBER"] as const;
export const WORKFLOW_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export const REVIEW_DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
export const SCHEDULE_STATUSES = ["NOT_SCHEDULED", "SCHEDULED", "PLAYING_CONFIRMED", "COMPLETED", "CANCELLED"] as const;

export type RoleCode = (typeof ROLE_CODES)[number];
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export type ReviewDecisionValue = (typeof REVIEW_DECISIONS)[number];
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** SQL list literal for CHECK constraints, e.g. 'A', 'B'. Values are static constants. */
export const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
