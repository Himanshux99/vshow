// Audit events. Always written with a Drizzle TRANSACTION handle, in the same transaction as the change they
// describe: if the change rolls back, the event never existed; if the audit insert fails, the change rolls back.
// Metadata is small and non-secret: ids, counts, codes. Never signed URLs, credentials, tokens or file contents.
import { auditEvent } from "../db/schema/workflow.ts";
import type { Tx } from "./access.server.ts";

export type AuditAction =
  | "SUBMISSION_CREATED"
  | "SUBMISSION_UPDATED"
  | "APPROVAL_INVALIDATED"
  | "MEDIA_VERSION_UPLOADED"
  | "SUBMISSION_SUBMITTED"
  | "REVIEW_APPROVED"
  | "REVIEW_REJECTED"
  | "CHANGES_REQUESTED"
  | "SCHEDULE_MARKED_DONE"
  | "SCHEDULE_UNDONE";

export type AuditEntity = "SUBMISSION" | "MEDIA_VERSION" | "REVIEW_DECISION" | "SCHEDULE_ENTRY";
type Meta = Record<string, string | number | boolean | null | string[]>;

export async function writeAudit(
  tx: Tx,
  event: {
    actorUserId: string;
    action: AuditAction;
    entityType: AuditEntity;
    entityId: string;
    submissionId: string;
    metadata?: Meta;
  },
): Promise<void> {
  await tx.insert(auditEvent).values({
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    submissionId: event.submissionId,
    metadata: event.metadata ?? null,
  });
}
