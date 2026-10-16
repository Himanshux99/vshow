// Editor for the requested display windows. Rows may overlap freely (including the same screen at the same time);
// the server validates the timestamps and screens. Times are entered and shown in campus time (Asia/Kolkata).
import { useState } from "react";
import { toCampusInputValue } from "../submissions/time.ts";

export interface EditableWindow {
  screenId: string;
  startAt: string;
  endAt: string;
  note: string;
}

export function WindowsEditor({
  screens,
  initial,
  name = "windows",
  maxWindows,
}: {
  screens: Array<{ id: string; name: string }>;
  initial: Array<{ screenId: string; startAt: string | null; endAt: string | null; note: string | null }>;
  name?: string;
  maxWindows: number;
}) {
  const [rows, setRows] = useState<EditableWindow[]>(
    initial.map((w) => ({
      screenId: w.screenId,
      startAt: w.startAt ? toCampusInputValue(w.startAt) : "",
      endAt: w.endAt ? toCampusInputValue(w.endAt) : "",
      note: w.note ?? "",
    })),
  );
  const update = (i: number, patch: Partial<EditableWindow>) =>
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  const field = "rounded border px-2 py-1 text-sm";

  return (
    <div>
      {/* The server receives the rows as JSON; it re-validates every value. */}
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length === 0 && <p className="mb-2 text-sm text-gray-600">No display windows yet.</p>}
      <ul className="space-y-3">
        {rows.map((row, i) => (
          <li key={i} className="grid gap-2 rounded border p-3 sm:grid-cols-2">
            <label className="text-sm">
              Screen
              <select
                className={`${field} mt-1 block w-full`}
                value={row.screenId}
                onChange={(e) => update(i, { screenId: e.target.value })}
              >
                <option value="">Choose a screen…</option>
                {screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Note (optional)
              <input
                className={`${field} mt-1 block w-full`}
                value={row.note}
                maxLength={500}
                onChange={(e) => update(i, { note: e.target.value })}
              />
            </label>
            <label className="text-sm">
              From (IST)
              <input
                type="datetime-local"
                className={`${field} mt-1 block w-full`}
                value={row.startAt}
                onChange={(e) => update(i, { startAt: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Until (IST)
              <input
                type="datetime-local"
                className={`${field} mt-1 block w-full`}
                value={row.endAt}
                onChange={(e) => update(i, { endAt: e.target.value })}
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="button"
                className="text-sm underline"
                onClick={() => setRows((r) => r.filter((_, n) => n !== i))}
              >
                Remove this window
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-3 rounded border px-3 py-1 text-sm disabled:opacity-50"
        disabled={rows.length >= maxWindows}
        onClick={() => setRows((r) => [...r, { screenId: screens[0]?.id ?? "", startAt: "", endAt: "", note: "" }])}
      >
        Add a window
      </button>
      <p className="mt-1 text-xs text-gray-600">
        Up to {maxWindows} windows. Windows may overlap; the Server Room Manager arranges overlapping media later.
      </p>
    </div>
  );
}
