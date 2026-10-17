// Server Room Manager handoff. Only APPROVED submissions are visible here. "Done" means the manager has downloaded the
// approved media and put it on the screens: it is recorded as one SCHEDULED schedule_entry per requested screen for the
// approved media version. Undo marks those entries CANCELLED (history is kept, nothing is deleted).
import { and, asc, eq, inArray } from "drizzle-orm";
import type { CurrentUser } from "../auth/authorize.server.ts";
import type { Db } from "../db/client.server.ts";
import { committee } from "../db/schema/campus.ts";
import { appUser } from "../db/schema/identity.ts";
import { submission, submissionRevision } from "../db/schema/submissions.ts";
import { scheduleEntry } from "../db/schema/workflow.ts";
import { isUuid, type SubmissionRow, type Tx, type WorkflowDeps } from "./access.server.ts";
import { writeAudit } from "./audit.server.ts";
import { WorkflowError, notFound, type FieldIssue } from "./errors.ts";
import { MANAGER_NOTE_MAX } from "./policy.ts";
import {
  activeScheduleEntries,
  head,
  isHandoffEligible,
  revisionsOf,
  versionsOf,
  type ListItem,
  type RevisionView,
  type VersionView,
} from "./queries.server.ts";

export const isManager = (actor: CurrentUser) => actor.roles.includes("SERVER_ROOM_MANAGER");

export interface ManagerListItem extends ListItem {
  /** When the manager marked it done; null while it is still to do. */
  doneAt: string | null;
}

export interface ManagerSubmissionView {
  id: string;
  referenceCode: string;
  title: string;
  committeeName: string;
  createdByName: string;
  /** The approved revision (frozen title, description and requested windows). */
  revision: RevisionView | null;
  /** Only the approved media version. */
  version: VersionView | null;
  done: { at: string; byName: string; note: string | null; screens: string[] } | null;
}

/** Loads an APPROVED, hand-off-eligible submission for a manager; anything else is "not found". */
export async function loadForManager(q: Db | Tx, actor: CurrentUser, id: string, lock = false): Promise<SubmissionRow> {
  if (!isManager(actor) || !isUuid(id)) throw notFound();
  const query = q.select().from(submission).where(eq(submission.id, id));
  const [row] = await (lock ? query.for("update") : query);
  if (!row || row.workflowStatus !== "APPROVED" || !row.currentRevisionId || !row.currentVersionId) throw notFound();
  return row;
}

/** Queue for the manager: approved submissions still to do, and those already done (newest first). */
export async function listManagerQueue(
  db: Db,
  actor: CurrentUser,
): Promise<{ todo: ManagerListItem[]; done: ManagerListItem[] }> {
  if (!isManager(actor)) return { todo: [], done: [] };
  const rows = await db
    .select({
      id: submission.id,
      referenceCode: submission.referenceCode,
      title: submission.title,
      status: submission.workflowStatus,
      committeeCode: committee.code,
      committeeName: committee.name,
      submittedAt: submission.submittedAt,
      updatedAt: submission.updatedAt,
      createdByName: appUser.displayName,
      versionId: submission.currentVersionId,
    })
    .from(submission)
    .innerJoin(committee, eq(committee.id, submission.committeeId))
    .innerJoin(appUser, eq(appUser.id, submission.createdByUserId))
    .where(eq(submission.workflowStatus, "APPROVED"))
    .orderBy(asc(submission.updatedAt))
    .limit(300);
  const ids = rows.map((r) => r.id);
  const entries = ids.length
    ? await db
        .select({
          submissionId: scheduleEntry.submissionId,
          versionId: scheduleEntry.mediaVersionId,
          at: scheduleEntry.updatedAt,
        })
        .from(scheduleEntry)
        .where(and(inArray(scheduleEntry.submissionId, ids), eq(scheduleEntry.status, "SCHEDULED")))
    : [];
  const doneAt = new Map<string, Date>();
  for (const e of entries) {
    const r = rows.find((x) => x.id === e.submissionId);
    if (!r || r.versionId !== e.versionId) continue; // done for an older version only: still to do
    const prev = doneAt.get(e.submissionId);
    if (!prev || e.at > prev) doneAt.set(e.submissionId, e.at);
  }
  const items = rows.map(({ versionId: _v, ...r }): ManagerListItem => {
    const at = doneAt.get(r.id) ?? null;
    return {
      ...r,
      status: "APPROVED",
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      doneAt: at ? at.toISOString() : null,
    };
  });
  return {
    todo: items.filter((i) => !i.doneAt),
    done: items.filter((i) => i.doneAt).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
  };
}

export async function getSubmissionForManager(db: Db, actor: CurrentUser, id: string): Promise<ManagerSubmissionView> {
  const row = await loadForManager(db, actor, id);
  const [h, revisions, versions, entries] = await Promise.all([
    head(db, row),
    revisionsOf(db, row),
    versionsOf(db, row, row.currentVersionId ? [row.currentVersionId] : []),
    activeScheduleEntries(db, row),
  ]);
  const first = entries[0];
  return {
    id: row.id,
    referenceCode: row.referenceCode,
    title: h.title,
    committeeName: h.committee.name,
    createdByName: h.createdByName,
    revision: revisions.find((r) => r.isCurrent) ?? null,
    version: versions[0] ?? null,
    done: first
      ? {
          at: entries.reduce((m, x) => (x.e.updatedAt > m ? x.e.updatedAt : m), first.e.updatedAt).toISOString(),
          byName: first.by,
          note: first.e.managerNote,
          screens: entries.map((x) => x.screenName),
        }
      : null,
  };
}

const parseNote = (input: unknown): string | null => {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") throw new WorkflowError("validation_failed", [{ path: "note", code: "invalid" }]);
  const note = input.trim();
  if (note.length > MANAGER_NOTE_MAX) {
    const issues: FieldIssue[] = [{ path: "note", code: "too_long" }];
    throw new WorkflowError("validation_failed", issues);
  }
  return note === "" ? null : note;
};

/** The distinct screens the approved revision asked for. */
async function requestedScreenIds(tx: Tx, row: SubmissionRow): Promise<string[]> {
  const [rev] = await tx
    .select({ windows: submissionRevision.requestedWindows })
    .from(submissionRevision)
    .where(eq(submissionRevision.id, row.currentRevisionId!));
  const windows = (rev?.windows ?? []) as Array<{ screenId: string }>;
  return [...new Set(windows.map((w) => w.screenId))];
}

/** Marks the approved media as put on the screens. Idempotent: already done is "invalid_state". */
export async function markDone(
  deps: WorkflowDeps,
  actor: CurrentUser,
  submissionId: string,
  input: { note?: unknown },
): Promise<void> {
  const note = parseNote(input.note);
  await deps.database.get().transaction(async (tx) => {
    const row = await loadForManager(tx, actor, submissionId, true);
    // Defense in depth: the latest decision on the CURRENT revision must be an approval.
    if (!(await isHandoffEligible(tx, row.id))) throw new WorkflowError("invalid_state");
    if ((await activeScheduleEntries(tx, row)).length > 0) throw new WorkflowError("invalid_state");
    const screenIds = await requestedScreenIds(tx, row);
    if (screenIds.length === 0) throw new WorkflowError("invalid_state");
    const created = await tx
      .insert(scheduleEntry)
      .values(
        screenIds.map((screenId) => ({
          submissionId: row.id,
          mediaVersionId: row.currentVersionId!,
          screenId,
          status: "SCHEDULED",
          managerNote: note,
          createdByUserId: actor.id,
          updatedByUserId: actor.id,
        })),
      )
      .returning({ id: scheduleEntry.id });
    await writeAudit(tx, {
      actorUserId: actor.id,
      action: "SCHEDULE_MARKED_DONE",
      entityType: "SCHEDULE_ENTRY",
      entityId: created[0].id,
      submissionId: row.id,
      metadata: { screens: screenIds.length },
    });
    deps.logger.info("submission marked done by manager", { submissionId: row.id, screens: screenIds.length });
  });
}

/** Undoes "done" (a mistake): active entries become CANCELLED. */
export async function undoDone(deps: WorkflowDeps, actor: CurrentUser, submissionId: string): Promise<void> {
  await deps.database.get().transaction(async (tx) => {
    const row = await loadForManager(tx, actor, submissionId, true);
    const entries = await activeScheduleEntries(tx, row);
    if (entries.length === 0) throw new WorkflowError("invalid_state");
    await tx
      .update(scheduleEntry)
      .set({ status: "CANCELLED", updatedByUserId: actor.id })
      .where(
        inArray(
          scheduleEntry.id,
          entries.map((x) => x.e.id),
        ),
      );
    await writeAudit(tx, {
      actorUserId: actor.id,
      action: "SCHEDULE_UNDONE",
      entityType: "SCHEDULE_ENTRY",
      entityId: entries[0].e.id,
      submissionId: row.id,
      metadata: { screens: entries.length },
    });
    deps.logger.info("manager done state undone", { submissionId: row.id });
  });
}
