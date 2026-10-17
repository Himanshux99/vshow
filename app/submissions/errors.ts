// Expected, user-facing failures of the submission workflow. Each has a fixed status, a stable machine code and a
// fixed message: nothing about the cause (a key, a URL, a SQL detail, another user's data) is ever put in one.
// Anything that is NOT a WorkflowError is an unexpected failure and keeps propagating to the normal error handling.

export type WorkflowErrorCode =
  | "not_found"
  | "forbidden"
  | "own_submission"
  | "invalid_state"
  | "stale_revision"
  | "validation_failed"
  | "storage_unavailable"
  | "upload_missing"
  | "upload_rejected"
  | "upload_closed"
  | "too_many_uploads"
  | "integrity_mismatch";

const STATUS: Record<WorkflowErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  own_submission: 403,
  invalid_state: 409,
  stale_revision: 409,
  validation_failed: 422,
  storage_unavailable: 503,
  upload_missing: 409,
  upload_rejected: 422,
  upload_closed: 409,
  too_many_uploads: 429,
  integrity_mismatch: 502,
};

const MESSAGE: Record<WorkflowErrorCode, string> = {
  not_found: "The requested item was not found.",
  forbidden: "You do not have permission to do this.",
  own_submission: "You cannot review a submission you created.",
  invalid_state: "This action is not allowed in the submission's current state.",
  stale_revision: "The submission changed since you opened it. Reload and review the current revision.",
  validation_failed: "Some of the submitted details are not valid.",
  storage_unavailable: "Media storage is not available right now.",
  upload_missing: "The uploaded file was not found. Finish the upload and try again.",
  upload_rejected: "The uploaded file was rejected and was not saved.",
  upload_closed: "This upload is no longer open. Start a new upload.",
  too_many_uploads: "Too many uploads are in progress for this submission. Finish or wait for them to expire.",
  integrity_mismatch: "The stored media does not match what was approved. Contact an administrator.",
};

export interface FieldIssue {
  /** Dot-separated field path, e.g. "windows.0.endAt". */
  path: string;
  /** Machine-readable reason, e.g. "end_not_after_start". Never the submitted value. */
  code: string;
}

export class WorkflowError extends Error {
  override name = "WorkflowError";
  readonly code: WorkflowErrorCode;
  readonly status: number;
  readonly issues: FieldIssue[];

  constructor(code: WorkflowErrorCode, issues: FieldIssue[] = []) {
    super(MESSAGE[code]);
    this.code = code;
    this.status = STATUS[code];
    this.issues = issues;
  }
}

export const notFound = () => new WorkflowError("not_found");
