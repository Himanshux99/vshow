// Corporate Communication review. A decision is recorded against the exact immutable REVISION the reviewer saw, in one
// transaction that locks the submission row. A decision on any other revision (a stale approval), on a submission that
// is not pending, or by the submission's own creator is refused; the database guards the same rules independently.
import { eq } from "drizzle-orm";
import type { CurrentUser } from "../auth/authorize.server.ts";
import { reviewDecision } from "../db/schema/workflow.ts";
import { submission, submissionRevision } from "../db/schema/submissions.ts";
import type { WorkflowStatus } from "../db/schema/values.ts";
import { loadForReviewer, type SubmissionRow, type WorkflowDeps } from "./access.server.ts";
import { writeAudit, type AuditAction } from "./audit.server.ts";
import { WorkflowError, type FieldIssue } from "./errors.ts";
import { STATUS_AFTER_DECISION, assertTransition, decisionNeedsComment } from "./policy.ts";
import { decisionSchema, issuesOf } from "./schemas.ts";

const AUDIT_ACTION = {
  APPROVED: "REVIEW_APPROVED",
  REJECTED: "REVIEW_REJECTED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
} as const satisfies Record<string, AuditAction>;

export interface DecisionResult {
  decisionId: string;
  submission: SubmissionRow;
}

export async function decide(
  deps: WorkflowDeps,
  actor: CurrentUser,
  submissionId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<DecisionResult> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError("validation_failed", issuesOf(parsed.error));
  const { revisionId, decision } = parsed.data;
  const comment = parsed.data.comment?.trim() ?? "";
  const issues: FieldIssue[] = [];
  if (decisionNeedsComment(decision) && comment === "") issues.push({ path: "comment", code: "required" });
  if (issues.length) throw new WorkflowError("validation_failed", issues);

  const db = deps.database.get();
  return db.transaction(async (tx) => {
    // Role, visibility (never a draft) and the row lock, in that order.
    const row = await loadForReviewer(tx, actor, submissionId, true);
    if (row.createdByUserId === actor.id) throw new WorkflowError("own_submission");
    const from = row.workflowStatus as WorkflowStatus;
    const to = STATUS_AFTER_DECISION[decision];
    if (from !== "PENDING_REVIEW") throw new WorkflowError("invalid_state");
    assertTransition(from, to);
    // The reviewer must be deciding on the revision that is current RIGHT NOW. Approving an older revision can
    // never make a newer one eligible.
    if (!row.currentRevisionId || revisionId !== row.currentRevisionId) throw new WorkflowError("stale_revision");

    const [revision] = await tx
      .select({ mediaVersionId: submissionRevision.mediaVersionId, revisionNumber: submissionRevision.revisionNumber })
      .from(submissionRevision)
      .where(eq(submissionRevision.id, revisionId));
    if (!revision) throw new WorkflowError("stale_revision");

    const [created] = await tx
      .insert(reviewDecision)
      .values({
        submissionId: row.id,
        mediaVersionId: revision.mediaVersionId,
        revisionId,
        reviewerUserId: actor.id,
        decision,
        comment: comment === "" ? null : comment,
      })
      .returning({ id: reviewDecision.id });
    const [updated] = await tx
      .update(submission)
      .set({ workflowStatus: to, closedAt: to === "REJECTED" ? now : row.closedAt })
      .where(eq(submission.id, row.id))
      .returning();
    await writeAudit(tx, {
      actorUserId: actor.id,
      action: AUDIT_ACTION[decision],
      entityType: "REVIEW_DECISION",
      entityId: created.id,
      submissionId: row.id,
      metadata: { revisionNumber: revision.revisionNumber, revisionId, decision },
    });
    deps.logger.info("review decision recorded", {
      submissionId: row.id,
      decision,
      revisionNumber: revision.revisionNumber,
    });
    return { decisionId: created.id, submission: updated };
  });
}
