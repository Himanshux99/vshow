// The submission state machine, as data. Pure: no database, no clock, no I/O. Every transition the services
// perform is checked against this table, and the tests walk every pair.
//
//   DRAFT ──submit──▶ PENDING_REVIEW ──approve──▶ APPROVED ──(approval-relevant edit)──▶ DRAFT
//                          │                                         ▲
//                          ├──request changes──▶ CHANGES_REQUESTED ──submit──▶ PENDING_REVIEW
//                          └──reject──▶ REJECTED (terminal; a resubmission is a NEW submission)
//
// A PENDING_REVIEW submission cannot be edited and (in Phase 1) cannot be withdrawn. CANCELLED exists in the schema
// but nothing moves a submission there yet.
import type { ReviewDecisionValue, WorkflowStatus } from "../db/schema/values.ts";
import { WorkflowError } from "./errors.ts";

export const TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  DRAFT: ["PENDING_REVIEW"],
  PENDING_REVIEW: ["APPROVED", "REJECTED", "CHANGES_REQUESTED"],
  CHANGES_REQUESTED: ["PENDING_REVIEW"],
  // Editing an approved submission withdraws the approval: it goes back to DRAFT and must be re-submitted.
  APPROVED: ["DRAFT"],
  REJECTED: [],
  CANCELLED: [],
};

export const canTransition = (from: WorkflowStatus, to: WorkflowStatus) => TRANSITIONS[from].includes(to);

export function assertTransition(from: WorkflowStatus, to: WorkflowStatus): void {
  if (!canTransition(from, to)) throw new WorkflowError("invalid_state");
}

/** States in which a convener may change title, description, windows or media. */
export const EDITABLE_STATUSES: readonly WorkflowStatus[] = ["DRAFT", "CHANGES_REQUESTED", "APPROVED"];
export const isEditable = (status: WorkflowStatus) => EDITABLE_STATUSES.includes(status);

/** States in which a convener may submit for review. */
export const SUBMITTABLE_STATUSES: readonly WorkflowStatus[] = ["DRAFT", "CHANGES_REQUESTED"];
export const isSubmittable = (status: WorkflowStatus) => SUBMITTABLE_STATUSES.includes(status);

/** The workflow status a review decision moves a PENDING_REVIEW submission to. */
export const STATUS_AFTER_DECISION: Record<ReviewDecisionValue, WorkflowStatus> = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
};

/** Drafts are invisible to reviewers; so is anything that was never submitted. */
export const isVisibleToReviewers = (status: WorkflowStatus) => status !== "DRAFT";

/** Decisions that must carry a written reason or comment. */
export const decisionNeedsComment = (decision: ReviewDecisionValue) => decision !== "APPROVED";
