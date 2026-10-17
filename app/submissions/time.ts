// Campus time. Requested windows are entered and shown in Asia/Kolkata (UTC+05:30, no daylight saving) and stored
// as UTC instants. Pure and dependency-free so the server, the tests and the browser all agree.

export const CAMPUS_TIMEZONE = "Asia/Kolkata";
const OFFSET_MINUTES = 330;

/** The calendar year in campus time (decides the YYYY of a reference code). */
export function campusYear(at: Date): number {
  return new Date(at.getTime() + OFFSET_MINUTES * 60_000).getUTCFullYear();
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parses a timestamp typed by a person or sent by a client. A value WITHOUT a zone (what a datetime-local input
 * produces) is campus time. A value with an explicit zone ("Z" or "+05:30") is honoured as given. Anything that is
 * not a real calendar date and time returns null.
 */
export function parseCampusDateTime(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  const local = LOCAL.exec(value);
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s ?? "0"].map(Number);
    if (hour > 23 || minute > 59 || second > 59) return null;
    const ms = Date.UTC(year, month - 1, day, hour, minute, second) - OFFSET_MINUTES * 60_000;
    const check = new Date(ms + OFFSET_MINUTES * 60_000);
    // Reject 2026-02-31 and friends: the date must survive a round trip.
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return new Date(ms);
  }
  if (WITH_ZONE.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The value for an <input type="datetime-local"> showing `at` in campus time. */
export function toCampusInputValue(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + OFFSET_MINUTES * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const display = new Intl.DateTimeFormat("en-IN", {
  timeZone: CAMPUS_TIMEZONE,
  dateStyle: "medium",
  timeStyle: "short",
});
/** Human-readable campus time, identical on the server and in the browser. */
export const formatCampus = (at: Date | string): string => `${display.format(new Date(at))} IST`;
