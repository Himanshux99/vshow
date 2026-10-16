// Small presentational pieces shared by the convener and reviewer pages. No data access here.
import { formatCampus } from "../submissions/time.ts";
import type { AuditView, DecisionView, VersionView, WindowView } from "../submissions/queries.server.ts";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  PENDING_REVIEW: "bg-blue-100 text-blue-900",
  CHANGES_REQUESTED: "bg-amber-100 text-amber-900",
  APPROVED: "bg-green-100 text-green-900",
  REJECTED: "bg-red-100 text-red-900",
  CANCELLED: "bg-gray-200 text-gray-700",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KiB` : `${n} B`;

export function ErrorNotice({
  error,
}: {
  error?: { message: string; issues?: Array<{ path: string; code: string }> };
}) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <p>{error.message}</p>
      {error.issues && error.issues.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {error.issues.map((i, n) => (
            <li key={`${i.path}-${i.code}-${n}`}>
              {i.path || "form"}: {i.code.replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WindowsTable({ windows }: { windows: WindowView[] }) {
  if (windows.length === 0) return <p className="text-sm text-gray-600">No display windows requested.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b">
          <th className="py-1 pr-3">Screen</th>
          <th className="py-1 pr-3">From</th>
          <th className="py-1 pr-3">Until</th>
          <th className="py-1">Note</th>
        </tr>
      </thead>
      <tbody>
        {windows.map((w, i) => (
          <tr key={`${w.screenId}-${w.slotNumber}-${i}`} className="border-b">
            <td className="py-1 pr-3">
              {w.screenName}
              {w.slotNumber > 1 ? ` (#${w.slotNumber})` : ""}
            </td>
            <td className="py-1 pr-3">{w.startAt ? formatCampus(w.startAt) : "—"}</td>
            <td className="py-1 pr-3">{w.endAt ? formatCampus(w.endAt) : "—"}</td>
            <td className="py-1">{w.note ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VersionList({ submissionId, versions }: { submissionId: string; versions: VersionView[] }) {
  if (versions.length === 0) return <p className="text-sm text-gray-600">No media uploaded yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {versions.map((v) => (
        <li key={v.id} className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-medium">Version {v.versionNumber}</span>
          {v.isCurrent && <span className="rounded bg-gray-100 px-1.5 text-xs">current</span>}
          <span>{v.originalFilename}</span>
          <span className="text-gray-600">
            {v.contentType}, {formatBytes(v.sizeBytes)}, {formatCampus(v.uploadedAt)}
          </span>
          <a className="underline" href={`/submissions/${submissionId}/versions/${v.id}/file`}>
            Download
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DecisionList({ decisions }: { decisions: DecisionView[] }) {
  if (decisions.length === 0) return <p className="text-sm text-gray-600">No review decisions yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {decisions.map((d) => (
        <li key={d.id} className="rounded border p-2">
          <p>
            <strong>{d.decision.replaceAll("_", " ").toLowerCase()}</strong> on revision {d.revisionNumber} by{" "}
            {d.reviewerName}, {formatCampus(d.createdAt)}
          </p>
          {d.comment && <p className="mt-1 whitespace-pre-wrap">{d.comment}</p>}
        </li>
      ))}
    </ul>
  );
}

export function AuditList({ events }: { events: AuditView[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {events.map((e) => (
        <li key={e.id}>
          {formatCampus(e.createdAt)} — {e.action.replaceAll("_", " ").toLowerCase()}
          {e.actorName ? ` by ${e.actorName}` : ""}
        </li>
      ))}
    </ul>
  );
}
