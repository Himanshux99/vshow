// Browser side of the upload flow: reserve -> PUT the file straight to object storage -> finalize.
// The file never passes through the Vshow server. NOTE: this exact browser flow (CORS, signed headers, a real
// bucket) has NOT been verified end to end yet; the server-side half is covered by automated tests.
// Everything the browser checks here is only a convenience: the server re-validates size, type and file signature.
import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { MEDIA_TYPES } from "../storage/file-types.ts";
import { formatBytes } from "./workflow-ui.tsx";

interface ApiFailure {
  error?: { code?: string; message?: string; issues?: Array<{ path: string; code: string }> };
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
};

function declaredType(file: File): string {
  if (file.type) return file.type;
  return EXT_TO_MIME[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = (await res.json().catch(() => ({}))) as { data?: unknown } & ApiFailure;
  return { ok: res.ok, status: res.status, json };
}

export function UploadPanel({
  submissionId,
  maxBytes,
  disabled,
}: {
  submissionId: string;
  maxBytes: number;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const revalidator = useRevalidator();
  const [state, setState] = useState<{ phase: "idle" | "working" | "done" | "error"; message: string }>({
    phase: "idle",
    message: "",
  });
  const accept = MEDIA_TYPES.map((t) => t.mime).join(",");

  async function start() {
    const file = input.current?.files?.[0];
    if (!file) return;
    const contentType = declaredType(file);
    if (!MEDIA_TYPES.some((t) => t.mime === contentType)) {
      setState({ phase: "error", message: "Only JPEG, PNG, WebP and MP4 files are accepted." });
      return;
    }
    if (file.size > maxBytes) {
      setState({ phase: "error", message: `The file is larger than the limit of ${formatBytes(maxBytes)}.` });
      return;
    }
    try {
      setState({ phase: "working", message: "Preparing upload…" });
      const init = await postJson(`/submissions/${submissionId}/upload`, {
        filename: file.name,
        contentType,
        sizeBytes: file.size,
      });
      const data = init.json.data as
        { reservationId: string; upload: { url: string; method: string; headers: Record<string, string> } } | undefined;
      if (!init.ok || !data) {
        setState({ phase: "error", message: init.json.error?.message ?? "The upload could not be started." });
        return;
      }
      setState({ phase: "working", message: "Uploading…" });
      const put = await fetch(data.upload.url, { method: "PUT", headers: data.upload.headers, body: file });
      if (!put.ok) {
        setState({ phase: "error", message: "The file could not be uploaded to storage. Please try again." });
        return;
      }
      setState({ phase: "working", message: "Checking the file…" });
      const fin = await postJson(`/submissions/${submissionId}/upload/finalize`, { reservationId: data.reservationId });
      if (!fin.ok) {
        const issue = fin.json.error?.issues?.[0]?.code?.replaceAll("_", " ");
        setState({
          phase: "error",
          message: `${fin.json.error?.message ?? "The file was not accepted."}${issue ? ` (${issue})` : ""}`,
        });
        return;
      }
      setState({ phase: "done", message: "Uploaded and checked. It is now the current version." });
      if (input.current) input.current.value = "";
      void revalidator.revalidate();
    } catch {
      // Network or CORS failures surface as a generic TypeError; never show internals.
      setState({ phase: "error", message: "The upload failed. Check your connection and try again." });
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={accept}
        disabled={disabled || state.phase === "working"}
        className="block text-sm"
      />
      <button
        type="button"
        onClick={start}
        disabled={disabled || state.phase === "working"}
        className="mt-2 rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        Upload new version
      </button>
      <p className="mt-1 text-xs text-gray-600">
        JPEG, PNG, WebP or MP4, up to {formatBytes(maxBytes)}. Uploading new media after approval requires approval
        again.
      </p>
      {state.message && (
        <p
          role={state.phase === "error" ? "alert" : "status"}
          className={`mt-2 text-sm ${state.phase === "error" ? "text-red-800" : ""}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
