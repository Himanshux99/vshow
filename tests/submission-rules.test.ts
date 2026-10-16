// The pure rules of the submission workflow: the state machine, campus time, requested windows and input schemas.
// No database, no network, no clock (callers pass "now").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WORKFLOW_STATUSES } from "../app/db/schema/values.ts";
import { WorkflowError } from "../app/submissions/errors.ts";
import {
  EDITABLE_STATUSES,
  STATUS_AFTER_DECISION,
  SUBMITTABLE_STATUSES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  decisionNeedsComment,
  isEditable,
  isVisibleToReviewers,
} from "../app/submissions/policy.ts";
import { createDraftSchema, decisionSchema, saveDraftSchema, uploadInitSchema } from "../app/submissions/schemas.ts";
import { campusYear, formatCampus, parseCampusDateTime, toCampusInputValue } from "../app/submissions/time.ts";
import { assignSlots, futureIssues, parseWindows, windowsFingerprint } from "../app/submissions/windows.ts";

const SCREEN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("state machine", () => {
  const legal: Array<[string, string]> = [
    ["DRAFT", "PENDING_REVIEW"],
    ["PENDING_REVIEW", "APPROVED"],
    ["PENDING_REVIEW", "REJECTED"],
    ["PENDING_REVIEW", "CHANGES_REQUESTED"],
    ["CHANGES_REQUESTED", "PENDING_REVIEW"],
    ["APPROVED", "DRAFT"],
  ];

  it("allows exactly the documented transitions and refuses every other pair", () => {
    for (const from of WORKFLOW_STATUSES) {
      for (const to of WORKFLOW_STATUSES) {
        const expected = legal.some(([a, b]) => a === from && b === to);
        assert.equal(canTransition(from, to), expected, `${from} -> ${to}`);
        if (expected) assertTransition(from, to);
        else {
          assert.throws(
            () => assertTransition(from, to),
            (e: unknown) => e instanceof WorkflowError && e.code === "invalid_state",
            `${from} -> ${to}`,
          );
        }
      }
    }
  });

  it("REJECTED and CANCELLED are terminal, and nothing can reach CANCELLED yet", () => {
    assert.deepEqual(TRANSITIONS.REJECTED, []);
    assert.deepEqual(TRANSITIONS.CANCELLED, []);
    assert.ok(WORKFLOW_STATUSES.every((s) => !canTransition(s, "CANCELLED")));
  });

  it("a pending submission is neither editable nor submittable (and there is no withdrawal)", () => {
    assert.ok(!isEditable("PENDING_REVIEW") && !isEditable("REJECTED") && !isEditable("CANCELLED"));
    assert.ok(!SUBMITTABLE_STATUSES.includes("PENDING_REVIEW") && !SUBMITTABLE_STATUSES.includes("APPROVED"));
    assert.deepEqual([...EDITABLE_STATUSES].sort(), ["APPROVED", "CHANGES_REQUESTED", "DRAFT"]);
    assert.ok(!canTransition("PENDING_REVIEW", "DRAFT"), "withdrawal is out of scope");
  });

  it("drafts are invisible to reviewers; every decision maps to its status; only approval needs no comment", () => {
    assert.equal(isVisibleToReviewers("DRAFT"), false);
    for (const s of WORKFLOW_STATUSES.filter((x) => x !== "DRAFT")) assert.equal(isVisibleToReviewers(s), true, s);
    assert.deepEqual(STATUS_AFTER_DECISION, {
      APPROVED: "APPROVED",
      REJECTED: "REJECTED",
      CHANGES_REQUESTED: "CHANGES_REQUESTED",
    });
    assert.deepEqual((["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const).map(decisionNeedsComment), [
      false,
      true,
      true,
    ]);
  });
});

describe("campus time (Asia/Kolkata)", () => {
  it("reads a zone-less value as IST and keeps an explicit zone as given", () => {
    assert.equal(parseCampusDateTime("2030-02-01T10:00")?.toISOString(), "2030-02-01T04:30:00.000Z");
    assert.equal(parseCampusDateTime("2030-02-01T10:00:30")?.toISOString(), "2030-02-01T04:30:30.000Z");
    assert.equal(parseCampusDateTime("2030-02-01T10:00:00+05:30")?.toISOString(), "2030-02-01T04:30:00.000Z");
    assert.equal(parseCampusDateTime("2030-02-01T10:00:00Z")?.toISOString(), "2030-02-01T10:00:00.000Z");
  });

  it("rejects anything that is not a real date and time", () => {
    for (const bad of [
      "",
      "tomorrow",
      "2030-02-30T10:00",
      "2030-13-01T10:00",
      "2030-02-01T24:00",
      "2030-02-01T10:60",
      "2030-02-01",
      "2030-02-01 10:00",
      "2030-02-01T10:00+0530",
      12345,
      null,
      undefined,
      {},
    ]) {
      assert.equal(parseCampusDateTime(bad), null, String(bad));
    }
    assert.ok(parseCampusDateTime("2032-02-29T10:00"), "2032 is a leap year");
    assert.equal(parseCampusDateTime("2031-02-29T10:00"), null);
  });

  it("derives the reference-code year from IST, not UTC", () => {
    assert.equal(campusYear(new Date("2031-12-31T18:29:59Z")), 2031);
    assert.equal(campusYear(new Date("2031-12-31T18:30:00Z")), 2032, "midnight IST");
    assert.equal(campusYear(new Date("2032-01-01T00:00:00Z")), 2032);
  });

  it("formats and round-trips values for display and for datetime-local inputs", () => {
    assert.equal(toCampusInputValue(new Date("2030-02-01T04:30:00Z")), "2030-02-01T10:00");
    assert.match(formatCampus("2030-02-01T04:30:00Z"), /IST$/);
    assert.equal(
      parseCampusDateTime(toCampusInputValue("2030-06-15T20:45:00Z"))?.toISOString(),
      "2030-06-15T20:45:00.000Z",
    );
  });
});

describe("requested windows", () => {
  const w = (startAt: string, endAt: string, screenId = SCREEN, note?: string) => ({ screenId, startAt, endAt, note });
  const run = (inputs: Parameters<typeof parseWindows>[0], maxWindows = 10) => parseWindows(inputs, { maxWindows });

  it("accepts valid windows and trims notes", () => {
    const { windows, issues } = run([w("2030-02-01T10:00", "2030-02-01T11:00", SCREEN, "  hello ")]);
    assert.deepEqual(issues, []);
    assert.equal(windows[0].note, "hello");
    assert.equal(windows[0].startAt.toISOString(), "2030-02-01T04:30:00.000Z");
  });

  it("ACCEPTS overlapping windows of every kind (identical, nested, partial, same or different screen)", () => {
    const all = [
      w("2030-02-01T10:00", "2030-02-01T12:00"),
      w("2030-02-01T10:00", "2030-02-01T12:00"), // identical
      w("2030-02-01T10:30", "2030-02-01T11:30"), // nested
      w("2030-02-01T11:00", "2030-02-01T13:00"), // partial overlap
      w("2030-02-01T10:00", "2030-02-01T12:00", OTHER), // other screen, same time
      w("2030-02-01T12:00", "2030-02-01T13:00"), // touching
    ];
    const { windows, issues } = run(all);
    assert.deepEqual(issues, []);
    assert.equal(windows.length, all.length);
  });

  it("rejects an invalid timestamp or an end that is not after the start, naming the field and the code only", () => {
    assert.deepEqual(run([w("nope", "2030-02-01T11:00")]).issues, [
      { path: "windows.0.startAt", code: "invalid_datetime" },
    ]);
    assert.deepEqual(run([w("2030-02-01T10:00", "")]).issues, [{ path: "windows.0.endAt", code: "invalid_datetime" }]);
    assert.deepEqual(run([w("2030-02-01T11:00", "2030-02-01T11:00")]).issues, [
      { path: "windows.0.endAt", code: "end_not_after_start" },
    ]);
    assert.deepEqual(run([w("2030-02-01T12:00", "2030-02-01T11:00")]).issues, [
      { path: "windows.0.endAt", code: "end_not_after_start" },
    ]);
    const mixed = run([w("2030-02-01T10:00", "2030-02-01T11:00"), w("bad", "bad")]);
    assert.deepEqual(mixed.windows, [], "no windows are returned when any is invalid");
  });

  it("limits the count by the configurable maximum (default 10 is the caller's choice)", () => {
    const many = (n: number) => Array.from({ length: n }, () => w("2030-02-01T10:00", "2030-02-01T11:00"));
    assert.deepEqual(run(many(10)).issues, []);
    assert.deepEqual(run(many(11)).issues, [{ path: "windows", code: "too_many_windows" }]);
    assert.deepEqual(run(many(3), 2).issues, [{ path: "windows", code: "too_many_windows" }]);
  });

  it("numbers slots per screen in order, and fingerprints ignore order but not content", () => {
    const parsed = run([
      w("2030-02-01T10:00", "2030-02-01T11:00"),
      w("2030-02-01T10:00", "2030-02-01T11:00", OTHER),
      w("2030-02-01T12:00", "2030-02-01T13:00"),
    ]).windows;
    assert.deepEqual(
      assignSlots(parsed).map((x) => `${x.screenId === SCREEN ? "A" : "B"}${x.slotNumber}`),
      ["A1", "B1", "A2"],
    );
    assert.equal(windowsFingerprint(parsed), windowsFingerprint([...parsed].reverse()));
    assert.notEqual(windowsFingerprint(parsed), windowsFingerprint(parsed.slice(1)));
  });

  it("requires the start to be in the future at the moment given", () => {
    const now = new Date("2030-02-01T04:30:00Z");
    const past = { startAt: new Date("2030-02-01T04:30:00Z") };
    const future = { startAt: new Date("2030-02-01T04:30:01Z") };
    assert.deepEqual(futureIssues([future], now), []);
    assert.deepEqual(futureIssues([past, future], now), [{ path: "windows.0.startAt", code: "start_not_in_future" }]);
  });
});

describe("input schemas", () => {
  it("require a title and trim text; bound lengths", () => {
    assert.ok(saveDraftSchema.safeParse({ title: "  ok  " }).success);
    assert.equal(saveDraftSchema.parse({ title: "  ok  " }).title, "ok");
    assert.ok(!saveDraftSchema.safeParse({ title: "   " }).success);
    assert.ok(!saveDraftSchema.safeParse({ title: "x".repeat(201) }).success);
    assert.ok(!saveDraftSchema.safeParse({ title: "x", description: "y".repeat(5001) }).success);
    assert.ok(!createDraftSchema.safeParse({ committeeId: "not-a-uuid", title: "x" }).success);
    assert.ok(createDraftSchema.safeParse({ committeeId: SCREEN, title: "x", resubmissionOfId: OTHER }).success);
  });

  it("validate upload requests and decisions", () => {
    assert.ok(uploadInitSchema.safeParse({ filename: "a.png", contentType: "image/png", sizeBytes: 10 }).success);
    for (const bad of [
      { sizeBytes: 0 },
      { sizeBytes: -1 },
      { sizeBytes: 1.5 },
      { filename: "" },
      { contentType: "" },
    ]) {
      assert.ok(
        !uploadInitSchema.safeParse({ filename: "a.png", contentType: "image/png", sizeBytes: 10, ...bad }).success,
      );
    }
    assert.ok(decisionSchema.safeParse({ revisionId: SCREEN, decision: "APPROVED" }).success);
    assert.ok(!decisionSchema.safeParse({ revisionId: SCREEN, decision: "MAYBE" }).success);
    assert.ok(!decisionSchema.safeParse({ revisionId: "x", decision: "APPROVED" }).success);
  });
});
