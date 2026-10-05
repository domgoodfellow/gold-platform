import type { ResourceSchedule, UnassignedWork } from '@/lib/domain/scheduling/availability';
import { clipWindow, zonedTimeToInstant, type Window } from '@/lib/domain/scheduling/window';

/**
 * Pixel/axis geometry for Day's timeline — never business logic (`CLAUDE.md`, "presentation code
 * organization"): what this module answers is "where on the screen", never "is this resource
 * free". The one thing it does decide, deliberately, is the *display* range the axis draws —
 * separate from `freeWindows`/`openWindows`'s own availability answer (I5/I6) so that drawing a
 * calendar never becomes a second claim about when a business is open.
 */

export const HOUR_MS = 3_600_000;
export const PX_PER_HOUR = 56;

/** A presentation-only default — not business hours, not availability, just something to draw when nothing else anchors the axis. */
export const DISPLAY_DAY_START_HOUR = 8;
export const DISPLAY_DAY_END_HOUR = 18;

function hourParts(instant: string, timeZone: string): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const field = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${field('year')}-${field('month')}-${field('day')}`, hour: Number(field('hour')) % 24, minute: Number(field('minute')) };
}

/** The start of the tenant's own clock-hour an instant falls in. */
export function floorToHour(instant: string, timeZone: string): string {
  const { date, hour } = hourParts(instant, timeZone);
  return zonedTimeToInstant(date, `${String(hour).padStart(2, '0')}:00`, timeZone);
}

/**
 * The start of the next tenant clock-hour, unless the instant already lands exactly on one.
 * Stepping by real time from here across a DST transition can drift the label by an hour on that
 * one day of the year; events themselves are always positioned from real instants regardless, so
 * only a gridline label could ever be affected.
 */
export function ceilToHour(instant: string, timeZone: string): string {
  const { date, hour, minute } = hourParts(instant, timeZone);
  const floor = zonedTimeToInstant(date, `${String(hour).padStart(2, '0')}:00`, timeZone);
  return minute === 0 ? floor : new Date(new Date(floor).getTime() + HOUR_MS).toISOString();
}

function unionWindow(a: Window, b: Window): Window {
  return {
    startsAt: a.startsAt < b.startsAt ? a.startsAt : b.startsAt,
    endsAt: a.endsAt > b.endsAt ? a.endsAt : b.endsAt,
  };
}

/**
 * What the timeline spans from real anchors alone — never an invented business day. `open` counts
 * as an anchor only when the business has actually said something (`showOpen`); bookings
 * contribute their *display* window, clipped to this tenant calendar day, never the canonical
 * one, so a booking spanning midnight can't pull the axis past the day being drawn.
 */
function realAxisBounds(open: Window[], resources: ResourceSchedule[], unassigned: UnassignedWork[], within: Window, showOpen: boolean): Window | null {
  const candidates: Window[] = showOpen ? [...open] : [];
  for (const entry of resources) {
    for (const booking of entry.booked) {
      const displayed = clipWindow(booking.window, within);
      if (displayed) candidates.push(displayed);
    }
  }
  for (const work of unassigned) {
    const displayed = clipWindow(work.window, within);
    if (displayed) candidates.push(displayed);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce(unionWindow, candidates[0]);
}

/**
 * The axis the Day board actually draws: real anchors (open hours shown, bookings) unioned with a
 * presentation-only default range, so the timeline is never empty — a business with no configured
 * hours and nothing booked still gets a sensible grid to look at, rather than a blank page. This
 * is display geometry only; it draws no new claim about availability, and `hasRealContent` says
 * whether anything shown was actually true rather than filler, for the caller's own messaging.
 */
export function computeDisplayAxisBounds(params: {
  date: string;
  timeZone: string;
  within: Window;
  open: Window[];
  resources: ResourceSchedule[];
  unassigned?: UnassignedWork[];
  hasConfiguredHours: boolean;
}): { bounds: Window; hasRealContent: boolean } {
  const { date, timeZone, within, open, resources, hasConfiguredHours } = params;
  const real = realAxisBounds(open, resources, params.unassigned ?? [], within, hasConfiguredHours);

  const fallback: Window = {
    startsAt: zonedTimeToInstant(date, `${String(DISPLAY_DAY_START_HOUR).padStart(2, '0')}:00`, timeZone),
    endsAt: zonedTimeToInstant(date, `${String(DISPLAY_DAY_END_HOUR).padStart(2, '0')}:00`, timeZone),
  };
  const clippedFallback = clipWindow(fallback, within) ?? within;

  const unioned = real ? unionWindow(real, clippedFallback) : clippedFallback;
  const start = floorToHour(unioned.startsAt, timeZone);
  const end = ceilToHour(unioned.endsAt, timeZone);

  return { bounds: { startsAt: start, endsAt: end }, hasRealContent: real !== null };
}

export function hourMarksFor(bounds: Window): { marks: string[]; hourCount: number } {
  const totalMs = Math.max(new Date(bounds.endsAt).getTime() - new Date(bounds.startsAt).getTime(), HOUR_MS);
  const hourCount = Math.round(totalMs / HOUR_MS);
  const marks = Array.from({ length: hourCount + 1 }, (_, index) =>
    new Date(new Date(bounds.startsAt).getTime() + index * HOUR_MS).toISOString(),
  );
  return { marks, hourCount };
}

/** Percent-of-axis helpers for absolutely-positioning an event inside the timeline. */
export function makeAxisScale(bounds: Window) {
  const start = new Date(bounds.startsAt).getTime();
  const totalMs = Math.max(new Date(bounds.endsAt).getTime() - start, HOUR_MS);
  return {
    offsetPct: (instant: string) => ((new Date(instant).getTime() - start) / totalMs) * 100,
    heightPct: (from: string, to: string) => ((new Date(to).getTime() - new Date(from).getTime()) / totalMs) * 100,
  };
}
