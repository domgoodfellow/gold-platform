/**
 * The scheduling core: a window of time a work item occupies on a resource. I9: every scheduled
 * item is an absolute instant, rendered in the tenant's timezone — `formatWindow` is the one
 * renderer, so there's one answer to what time a job is.
 */

export type Window = {
  /** ISO 8601, absolute. Inclusive. */
  startsAt: string;
  /** ISO 8601, absolute. Exclusive — a job ending at 10:00 leaves 10:00 free. */
  endsAt: string;
};

// Postgres renders a bounded tstzrange as ["2026-08-27 09:00:00+00","2026-08-27 10:00:00+00").
// The database guarantees the shape (bounded, non-empty, half-open), so this is a parser, not a validator.
const RANGE = /^\[\s*"?([^",]+?)"?\s*,\s*"?([^",]+?)"?\s*\)$/;

// Postgres writes `+00`; the ECMAScript date grammar wants `+00:00`.
const OFFSET = /([+-])(\d{2})(?::?(\d{2}))?$/;

function toIso(raw: string): string | null {
  const candidate = raw.trim().replace(' ', 'T');
  const offset = OFFSET.exec(candidate);
  const normalised = offset
    ? `${candidate.slice(0, -offset[0].length)}${offset[1]}${offset[2]}:${offset[3] ?? '00'}`
    : candidate;

  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Null rather than throwing on a malformed range — an unreadable window is treated as unscheduled rather than breaking the whole board. */
export function parseWindow(raw: string | null | undefined): Window | null {
  if (!raw) return null;

  const match = RANGE.exec(raw);
  if (!match) return null;

  const startsAt = toIso(match[1]);
  const endsAt = toIso(match[2]);
  if (!startsAt || !endsAt) return null;

  return { startsAt, endsAt };
}

/** The organization's zone, never the server's or the reader's browser's. */
export function formatWindow(window: Window, timeZone: string): string {
  const start = new Date(window.startsAt);
  const end = new Date(window.endsAt);

  try {
    const day = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(start);

    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    });

    return `${day}, ${time.format(start)}–${time.format(end)}`;
  } catch {
    // A zone Postgres knows and ICU doesn't — vanishingly unlikely, but UTC beats throwing.
    return `${window.startsAt} – ${window.endsAt}`;
  }
}

/** Whether two windows overlap, treating both as half-open. */
export function overlaps(a: Window, b: Window): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** No API answers this directly — derived by formatting the instant in the zone and reading the fields back as though they were UTC. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    // Some ICU versions render midnight as hour 24 under hour12: false.
    field('hour') % 24,
    field('minute'),
    field('second'),
  );

  return asIfUtc - instant.getTime();
}

/**
 * The instants that bound one calendar day as the tenant experiences it — not always 24 hours
 * from midnight UTC, and not 24 hours at all across a DST transition.
 *
 * @param date `YYYY-MM-DD`, as the tenant reads it.
 */
export function zonedDayRange(date: string, timeZone: string): Window {
  const [year, month, day] = date.split('-').map(Number);

  const boundary = (utcMidnight: number) => {
    // Two passes — the offset that applies is the offset at the answer, not at the guess.
    const first = utcMidnight - offsetMs(new Date(utcMidnight), timeZone);
    return new Date(utcMidnight - offsetMs(new Date(first), timeZone)).toISOString();
  };

  return {
    startsAt: boundary(Date.UTC(year, month - 1, day)),
    endsAt: boundary(Date.UTC(year, month - 1, day + 1)),
  };
}

/** Today, as the tenant reads it, in `YYYY-MM-DD`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

/**
 * The instant a wall-clock reading occurs on a given day, in a given zone — turns "we open at
 * 09:00 on Tuesdays" into something a schedule can subtract from.
 *
 * @param date `YYYY-MM-DD`, as the tenant reads it.
 * @param time `HH:MM` or `HH:MM:SS`, as the tenant reads it.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);

  const naive = Date.UTC(year, month - 1, day, hour, minute ?? 0, second ?? 0);

  // Two passes, same reasoning as zonedDayRange.
  const first = naive - offsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs(new Date(first), timeZone)).toISOString();
}

/**
 * ISO 8601 day of the week: 1 is Monday through 7 is Sunday. No zone involved — the date string
 * is already the tenant's own calendar date. A number, never a name — which days a business
 * works is configuration; what to call them is the reader's locale.
 */
export function isoDayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sundayFirst === 0 ? 7 : sundayFirst;
}

/**
 * A calendar date, `days` tenant-calendar days later (or earlier, for a negative count). Pure
 * string arithmetic on the date, not an instant — a calendar day is a fact about the calendar,
 * never about a zone, so nothing here touches `timeZone`.
 */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
