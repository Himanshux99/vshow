// Editor for the requested display windows. Rows may overlap freely (including the same screen at the same time);
// the server validates the timestamps and screens. Times are entered and shown in campus time (Asia/Kolkata).
import { useId, useState } from "react";
import { toCampusInputValue } from "../submissions/time.ts";
import { DateTimePicker } from "./date-time-picker.tsx";

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
  const uid = useId();

  return (
    <div>
      {/* The server receives the rows as JSON; it re-validates every value. */}
      <input type="hidden" name={name} value={JSON.stringify(rows)} />
      {rows.length === 0 && (
        <p className="mb-4 text-dim">No display windows yet. Add at least one before submitting.</p>
      )}
      <ul className="m-0 list-none space-y-4 p-0">
        {rows.map((row, i) => (
          <li key={i} className="panel">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="mono text-xs font-medium tracking-widest text-dim uppercase">Window {i + 1}</h3>
              <button type="button" className="btn-text" onClick={() => setRows((r) => r.filter((_, n) => n !== i))}>
                Remove<span className="sr-only"> window {i + 1}</span>
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={`${uid}-screen-${i}`}>
                  Screen
                </label>
                <select
                  id={`${uid}-screen-${i}`}
                  className="field"
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
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-note-${i}`}>
                  Note (optional)
                </label>
                <input
                  id={`${uid}-note-${i}`}
                  className="field"
                  value={row.note}
                  maxLength={500}
                  onChange={(e) => update(i, { note: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-from-${i}`}>
                  From (IST)
                </label>
                <DateTimePicker
                  id={`${uid}-from-${i}`}
                  value={row.startAt}
                  onChange={(startAt) => update(i, { startAt })}
                />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-until-${i}`}>
                  Until (IST)
                </label>
                <DateTimePicker
                  id={`${uid}-until-${i}`}
                  value={row.endAt}
                  min={row.startAt}
                  onChange={(endAt) => update(i, { endAt })}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn-ghost mt-4"
        disabled={rows.length >= maxWindows}
        onClick={() => setRows((r) => [...r, { screenId: screens[0]?.id ?? "", startAt: "", endAt: "", note: "" }])}
      >
        + Add a window
      </button>
      <p className="hint">
        Up to {maxWindows} windows. Windows may overlap; the Server Room Manager arranges overlapping media later.
        Requested times are preferences, not bookings.
      </p>
    </div>
  );
}
