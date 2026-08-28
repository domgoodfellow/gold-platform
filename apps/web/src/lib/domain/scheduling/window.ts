/**
 * The scheduling core: a window of time a work item occupies on a resource.
 *
 * **This directory is not a module.** `domain-model.md` lists `scheduling` among the things
 * that are "not yet modules", and that rule is about a second *business* needing the same
 * capability. A directory under `lib/domain/` is the ordinary place a rule lives, exactly as
 * `work-items/` and `tenancy/` are — and the same document is explicit that scheduling,
 * dispatch, booking and maintenance must be *one* engine over Work Item and Resource rather
 * than four. This is that one engine. What would breach the rule is a `packages/scheduling`
 * or an entry in the module table, and neither exists.
 *
 * I9 lives here: "Every scheduled item is an absolute instant, rendered in the tenant's
 * timezone." The first half is `timestamptz` and `tstzrange`, which the type system
 * guarantees. The second half is `formatWindow` — one renderer, so there is one answer to
 * what time a job is, and it is never the server's clock or the reader's.
 */

export type Window = {
  /** ISO 8601, absolute. Inclusive. */
  startsAt: string;
  /** ISO 8601, absolute. Exclusive — a job ending at 10:00 leaves 10:00 free. */
  endsAt: string;
};

// Postgres renders a bounded tstzrange as ["2026-08-27 09:00:00+00","2026-08-27 10:00:00+00").
// The database guarantees the shape — `work_items_window_is_bounded_half_open` requires
// bounded, non-empty and `[)` — so this pattern is a parser rather than a validator.
const RANGE = /^\[\s*"?([^",]+?)"?\s*,\s*"?([^",]+?)"?\s*\)$/;

// Postgres writes `+00`; the ECMAScript date grammar wants `+00:00`. V8 happens to accept
// both, which is exactly why this is done explicitly: "happens to accept" is not a contract.
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

/**
 * Read a window off a row, or null if there is not one.
 *
 * Returns null rather than throwing on a malformed range. A work item whose window cannot be
 * read is a work item that is not scheduled as far as any screen is concerned, which is the
 * safe direction: the alternative is a board that will not render at all.
 */
export function parseWindow(raw: string | null | undefined): Window | null {
  if (!raw) return null;

  const match = RANGE.exec(raw);
  if (!match) return null;

  const startsAt = toIso(match[1]);
  const endsAt = toIso(match[2]);
  if (!startsAt || !endsAt) return null;

  return { startsAt, endsAt };
}

/**
 * The one place an instant becomes a time a person reads. I9's second half.
 *
 * The zone is the organization's, never the server's and never the reader's browser's: two
 * people in one business must agree about when a job is, and a dispatcher in Lisbon looking
 * at a Rotterdam schedule needs Rotterdam's clock.
 */
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
    // A zone Postgres knows and ICU does not. Vanishingly unlikely — the column is checked
    // against `pg_timezone_names` — but a schedule that renders in UTC is better than a
    // schedule that throws.
    return `${window.startsAt} – ${window.endsAt}`;
  }
}

/** Whether two windows overlap, treating both as half-open. */
export function overlaps(a: Window, b: Window): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * What the tenant's clock reads as the offset from UTC at a given instant.
 *
 * There is no API that answers this directly, so it is derived: format the instant in the
 * zone, read the fields back as though they were UTC, and take the difference.
 */
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
 * The instants that bound one calendar day *as the tenant experiences it*.
 *
 * A day is not 24 hours from midnight UTC, and on the two days a year a zone changes offset
 * it is not 24 hours at all. Getting this wrong shows up as work vanishing from a schedule
 * on exactly those days, which is the kind of bug that is reported as "the app broke in
 * March" and never reproduced.
 *
 * @param date `YYYY-MM-DD`, as the tenant reads it.
 */
export function zonedDayRange(date: string, timeZone: string): Window {
  const [year, month, day] = date.split('-').map(Number);

  const boundary = (utcMidnight: number) => {
    // Two passes, because the offset that applies is the offset *at the answer*, not at the
    // guess. One pass is wrong across a transition; the second lands on it.
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
 * The instant at which a wall-clock reading occurs on a given day, in a given zone.
 *
 * This is what turns "we open at 09:00 on Tuesdays" into something a schedule can subtract
 * from. The reading is local and recurring; the answer is absolute — which is I9's whole
 * shape, applied in the deriving direction rather than the rendering one.
 *
 * @param date `YYYY-MM-DD`, as the tenant reads it.
 * @param time `HH:MM` or `HH:MM:SS`, as the tenant reads it.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);

  const naive = Date.UTC(year, month - 1, day, hour, minute ?? 0, second ?? 0);

  // Two passes, for the same reason zonedDayRange needs them: the offset that applies is the
  // offset at the answer, not at the guess.
  const first = naive - offsetMs(new Date(naive), timeZone);
  return new Date(naive - offsetMs(new Date(first), timeZone)).toISOString();
}

/**
 * ISO 8601 day of the week for a calendar date: 1 is Monday through 7 is Sunday.
 *
 * The date string is already the tenant's own calendar date, so no zone is involved — which
 * day of the week the 15th falls on is not a question anybody's timezone can change.
 *
 * The platform holds a *number*, never a name. Which days a business works is its
 * configuration, and what those days are called is the reader's locale.
 */
export function isoDayOfWeek(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sundayFirst === 0 ? 7 : sundayFirst;
}
