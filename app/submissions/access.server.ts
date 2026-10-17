// Resource-level authorization for submissions. A route guard (requireRole) proves WHO is asking and that they hold a
// role; this module decides whether they may touch THIS submission, by loading the actual row and checking the actual
// committee membership / ownership / role, before anything about it is returned or changed.
//
//  - Convener: CONVENER role AND an active membership in the submission's committee (canActForCommittee). Any such
//    convener may manage any of that committee's submissions, subject to the submission's state.
//  - Reviewer: REVIEWER role; global across committees; never sees a DRAFT. May not decide on their own submission.
//  - Administrator: no implicit access to any of this (roles stay explicit).
//  A submission the caller may not see is reported as "not found", so ids cannot be probed.
import { eq } from "drizzle-orm";
import { canActForCommittee, type CurrentUser } from "../auth/authorize.server.ts";
import type { Db, DbProvider } from "../db/client.server.ts";
import { submission } from "../db/schema/submissions.ts";
import type { WorkflowStatus } from "../db/schema/values.ts";
import type { Logger } from "../logging/logger.server.ts";
import type { ObjectStorage } from "../storage/object-storage.server.ts";
import { WorkflowError, notFound } from "./errors.ts";
import type { MediaPolicy } from "./media-policy.server.ts";
import { isVisibleToReviewers } from "./policy.ts";

/** What the workflow services need. A request scope satisfies it; tests build their own. */
export interface WorkflowDeps {
  database: DbProvider;
  logger: Logger;
  storage: ObjectStorage;
  media: MediaPolicy;
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type SubmissionRow = typeof submission.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const isConvenerFor = (actor: CurrentUser, row: Pick<SubmissionRow, "committeeId">) =>
  canActForCommittee(actor, row.committeeId);
export const isReviewer = (actor: CurrentUser) => actor.roles.includes("REVIEWER");

async function fetchSubmission(q: Db | Tx, id: string, lock: boolean): Promise<SubmissionRow | undefined> {
  if (!isUuid(id)) return undefined;
  const query = q.select().from(submission).where(eq(submission.id, id));
  const rows = await (lock ? query.for("update") : query);
  return rows[0];
}

/**
 * Loads a submission for a convener of its committee. `lock` takes a row lock (use inside a transaction for every
 * state change). Anything else is "not found".
 */
export async function loadForConvener(
  q: Db | Tx,
  actor: CurrentUser,
  id: string,
  lock = false,
): Promise<SubmissionRow> {
  const row = await fetchSubmission(q, id, lock);
  if (!row || !isConvenerFor(actor, row)) throw notFound();
  return row;
}

/** Loads a non-draft submission for a reviewer. Drafts, and callers without the REVIEWER role, get "not found". */
export async function loadForReviewer(
  q: Db | Tx,
  actor: CurrentUser,
  id: string,
  lock = false,
): Promise<SubmissionRow> {
  if (!isReviewer(actor)) throw notFound();
  const row = await fetchSubmission(q, id, lock);
  if (!row || !isVisibleToReviewers(row.workflowStatus as WorkflowStatus)) throw notFound();
  return row;
}

export function assertCanCreateFor(actor: CurrentUser, committeeId: string): void {
  if (!canActForCommittee(actor, committeeId)) throw new WorkflowError("forbidden");
}
