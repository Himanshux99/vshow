// Object-key policy. Keys are built ONLY from server-generated UUIDs and a fixed extension chosen from the
// validated content type. A user-supplied filename (or any other client input) is never part of a key.
import { extensionFor } from "./file-types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const assertUuid = (v: string, what: string) => {
  if (!UUID.test(v)) throw new Error(`${what} must be a UUID.`);
};

/** Where the browser uploads (the only key an upload URL is ever signed for). Never referenced by a media version. */
export function stagingKey(submissionId: string, reservationId: string): string {
  assertUuid(submissionId, "submissionId");
  assertUuid(reservationId, "reservationId");
  return `staging/${submissionId}/${reservationId}`;
}

/** Where a finalized, validated version lives. No upload URL is ever created for it. */
export function finalKey(submissionId: string, versionId: string, contentType: string): string {
  assertUuid(submissionId, "submissionId");
  assertUuid(versionId, "versionId");
  const ext = extensionFor(contentType);
  if (!ext) throw new Error("Unsupported content type for a media key.");
  return `media/${submissionId}/${versionId}.${ext}`;
}

export const isStagingKey = (key: string) => key.startsWith("staging/");
