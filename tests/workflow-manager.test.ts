// Server Room Manager handoff against a REAL migrated database: only approved submissions are visible, "done" records
// one SCHEDULED entry per requested screen, undo cancels them, and nobody else can see or do any of it.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { WorkflowError, type WorkflowErrorCode } from "../app/submissions/errors.ts";
import { getSubmissionForManager, listManagerQueue, markDone, undoDone } from "../app/submissions/manager.server.ts";
import { getSubmissionForConvener } from "../app/submissions/queries.server.ts";
import { decide } from "../app/submissions/reviews.server.ts";
import { createDraft, saveDraft, submitForReview } from "../app/submissions/submissions.server.ts";
import { finalizeUpload, initUpload, createMediaDownloadUrl } from "../app/submissions/uploads.server.ts";
import { PNG, createWorkflowHarness, type PersonKey } from "./support/workflow-harness.ts";

const h = await createWorkflowHarness("vshow_test_wfmgr");
const opts = { skip: h.skipReason || false };
after(async () => {
  if (!h.skipReason) await h.close();
});

const NOW = new Date("2030-01-01T00:00:00Z");
const win = (screenId: string, start = "2030-02-01T10:00", end = "2030-02-01T12:00") => ({
  screenId,
  startAt: start,
  endAt: end,
});

async function expectCode(p: Promise<unknown>, code: WorkflowErrorCode) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof WorkflowError, `expected WorkflowError(${code}), got ${String(e)}`);
    assert.equal(e.code, code);
    return true;
  });
}

/** A submission taken all the way to `stage`. */
async function make(stage: "submitted" | "approved", windows = [win("lobby"), win("canteen")]) {
  const convener = await h.actor("convener");
  const s = await createDraft(h.deps, convener, { committeeId: h.ids.media, title: "Poster", description: "x" });
  await saveDraft(h.deps, convener, s.id, {
    title: "Poster",
    description: "x",
    windows: windows.map((w) => ({ ...w, screenId: h.ids[w.screenId as "lobby" | "canteen"] })),
  });
  const init = await initUpload(h.deps, convener, s.id, {
    filename: "p.png",
    contentType: "image/png",
    sizeBytes: PNG.length,
  });
  h.storage.upload(init.upload, PNG);
  const { versionId } = await finalizeUpload(h.deps, convener, s.id, init.reservationId);
  const sub = await submitForReview(h.deps, convener, s.id, NOW);
  if (stage === "approved") {
    await decide(h.deps, await h.actor("reviewer"), s.id, { revisionId: sub.revisionId, decision: "APPROVED" });
  }
  return { id: s.id, versionId };
}
const entries = async (id: string) =>
  h.q<{ status: string; manager_note: string | null }>(
    "select status, manager_note from schedule_entry where submission_id=$1 order by created_at, id",
    [id],
  );

describe("server room manager", () => {
  it("only sees approved submissions, split into to-do and done", opts, async () => {
    const pending = await make("submitted");
    const approved = await make("approved");
    const q = await listManagerQueue(h.deps.database.get(), await h.actor("manager"));
    const todo = q.todo.map((i) => i.id);
    assert.ok(todo.includes(approved.id));
    assert.ok(!todo.includes(pending.id));
    assert.ok(!q.done.some((i) => i.id === approved.id));
    await expectCode(getSubmissionForManager(h.deps.database.get(), await h.actor("manager"), pending.id), "not_found");
  });

  it("other roles get nothing", opts, async () => {
    const approved = await make("approved");
    for (const who of ["convener", "reviewer", "admin", "unassigned"] as PersonKey[]) {
      const a = await h.actor(who);
      assert.deepEqual(await listManagerQueue(h.deps.database.get(), a), { todo: [], done: [] });
      await expectCode(getSubmissionForManager(h.deps.database.get(), a, approved.id), "not_found");
      await expectCode(markDone(h.deps, a, approved.id, {}), "not_found");
    }
  });

  it(
    "mark done creates one SCHEDULED entry per requested screen, with the note, and moves it to done",
    opts,
    async () => {
      const approved = await make("approved", [
        win("lobby"),
        win("lobby", "2030-03-01T10:00", "2030-03-01T11:00"),
        win("canteen"),
      ]);
      const manager = await h.actor("manager");
      await markDone(h.deps, manager, approved.id, { note: "  On both screens  " });
      const rows = await entries(approved.id);
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => r.status === "SCHEDULED" && r.manager_note === "On both screens"));
      const q = await listManagerQueue(h.deps.database.get(), manager);
      assert.ok(q.done.some((i) => i.id === approved.id));
      assert.ok(!q.todo.some((i) => i.id === approved.id));
      const view = await getSubmissionForManager(h.deps.database.get(), manager, approved.id);
      assert.equal(view.done?.screens.length, 2);
      // the convener sees it is live
      const conv = await getSubmissionForConvener(h.deps.database.get(), await h.actor("convener"), approved.id);
      assert.ok(conv.liveOnScreens);
    },
  );

  it(
    "marking done twice is refused; undo cancels and the item is to-do again; undo twice is refused",
    opts,
    async () => {
      const approved = await make("approved");
      const manager = await h.actor("manager");
      await markDone(h.deps, manager, approved.id, {});
      await expectCode(markDone(h.deps, manager, approved.id, {}), "invalid_state");
      await undoDone(h.deps, manager, approved.id);
      assert.ok((await entries(approved.id)).every((r) => r.status === "CANCELLED"));
      const q = await listManagerQueue(h.deps.database.get(), manager);
      assert.ok(q.todo.some((i) => i.id === approved.id));
      await expectCode(undoDone(h.deps, manager, approved.id), "invalid_state");
      await markDone(h.deps, manager, approved.id, {}); // can be done again
      const conv = await getSubmissionForConvener(h.deps.database.get(), await h.actor("convener"), approved.id);
      assert.ok(conv.liveOnScreens);
    },
  );

  it("refuses an over-long note and records an audit trail", opts, async () => {
    const approved = await make("approved");
    const manager = await h.actor("manager");
    await expectCode(markDone(h.deps, manager, approved.id, { note: "x".repeat(1001) }), "validation_failed");
    assert.equal((await entries(approved.id)).length, 0);
    await markDone(h.deps, manager, approved.id, {});
    await undoDone(h.deps, manager, approved.id);
    const a = (
      await h.q<{ action: string }>("select action from audit_event where submission_id=$1 order by created_at, id", [
        approved.id,
      ])
    ).map((r) => r.action);
    assert.deepEqual(a.slice(-2), ["SCHEDULE_MARKED_DONE", "SCHEDULE_UNDONE"]);
  });

  it("may download only the approved version of an approved submission", opts, async () => {
    const approved = await make("approved");
    const pending = await make("submitted");
    const manager = await h.actor("manager");
    const url = await createMediaDownloadUrl(h.deps, manager, approved.id, approved.versionId, { as: "manager" });
    assert.ok(url);
    await expectCode(
      createMediaDownloadUrl(h.deps, manager, pending.id, pending.versionId, { as: "manager" }),
      "not_found",
    );
    await expectCode(
      createMediaDownloadUrl(h.deps, await h.actor("reviewer"), approved.id, approved.versionId, { as: "manager" }),
      "not_found",
    );
  });
});
