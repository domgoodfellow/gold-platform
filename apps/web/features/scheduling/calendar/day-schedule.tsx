import { EmptyState } from '@/components/surfaces/section';
import type { ResourceSchedule } from '@/lib/domain/scheduling/availability';
import { clipWindow, zonedTimeToInstant, type Window } from '@/lib/domain/scheduling/window';
import { ScheduleEvent } from './schedule-event';

/**
 * "What is each Resource doing today, and when?" — a time axis on the left, one lane per visible
 * Resource. Because the exclusion constraint already refuses two bookings on one Resource at
 * once, a lane never has to lay out an overlap: every booking gets its own absolutely-positioned
 * block, offset and sized from its real instants, and nothing here recomputes whether two of them
 * collide.
 */

const PX_PER_HOUR = 56;
const HOUR_MS = 3_600_000;

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

/** The start of the tenant's own clock-hour an instant falls in — the timeline's lower bound. */
function floorToHour(instant: string, timeZone: string): string {
  const { date, hour } = hourParts(instant, timeZone);
  return zonedTimeToInstant(date, `${String(hour).padStart(2, '0')}:00`, timeZone);
}

/**
 * The start of the next tenant clock-hour, unless the instant already lands exactly on one —
 * the timeline's upper bound. Stepping by real time from here across a DST transition can drift
 * the label by an hour on that one day of the year; the events themselves are always positioned
 * from real instants regardless, so only a gridline label could ever be affected.
 */
function ceilToHour(instant: string, timeZone: string): string {
  const { date, hour, minute } = hourParts(instant, timeZone);
  const floor = zonedTimeToInstant(date, `${String(hour).padStart(2, '0')}:00`, timeZone);
  return minute === 0 ? floor : new Date(new Date(floor).getTime() + HOUR_MS).toISOString();
}

function formatHourLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

/**
 * What the timeline spans — real anchors only, never an invented business day. `open` counts as
 * an anchor only when the business has actually said something (`showOpen`); an unconfigured
 * schedule's default "whole day" is not a claim worth drawing a 24-hour axis around, so an
 * otherwise-empty day falls through to the empty state instead.
 *
 * Bookings contribute their *display* window — clipped to this tenant calendar day — never the
 * canonical one: a booking that spans midnight would otherwise pull the axis (and the day's own
 * events) past the day it is being drawn for.
 */
function computeAxisBounds(open: Window[], resources: ResourceSchedule[], within: Window, showOpen: boolean): Window | null {
  const candidates: Window[] = showOpen ? [...open] : [];
  for (const entry of resources) {
    for (const booking of entry.booked) {
      const displayed = clipWindow(booking.window, within);
      if (displayed) candidates.push(displayed);
    }
  }
  if (candidates.length === 0) return null;

  return {
    startsAt: candidates.reduce((min, window) => (window.startsAt < min ? window.startsAt : min), candidates[0].startsAt),
    endsAt: candidates.reduce((max, window) => (window.endsAt > max ? window.endsAt : max), candidates[0].endsAt),
  };
}

export function DaySchedule({
  organizationId,
  within,
  open,
  resources,
  hasConfiguredHours,
  timezone,
}: {
  organizationId: string;
  /** This tenant calendar day's own bounds (`ScheduleDay.within`) — what a booking's display window is clipped to. */
  within: Window;
  /** This day's own open periods, from `ScheduleDay.open` — used only to decide whether there is anything to anchor an otherwise-empty day's axis to. */
  open: Window[];
  resources: ResourceSchedule[];
  /** Whether this business has configured opening hours anywhere at all — see `computeAxisBounds`. */
  hasConfiguredHours: boolean;
  timezone: string;
}) {
  if (resources.length === 0) {
    return (
      <EmptyState className="mt-6">
        Nothing to schedule against yet. A resource is whoever or whatever work occupies for a
        window — a technician, a van, a machine.
      </EmptyState>
    );
  }

  const showOpen = hasConfiguredHours;
  const bounds = computeAxisBounds(open, resources, within, showOpen);

  if (!bounds) {
    return (
      <EmptyState className="mt-6">
        {hasConfiguredHours
          ? 'Closed — no hours are configured for this day, and nothing is scheduled.'
          : 'Nothing is scheduled, and this business has not set opening hours — there is nothing yet to anchor a timeline to.'}
      </EmptyState>
    );
  }

  const start = floorToHour(bounds.startsAt, timezone);
  const end = ceilToHour(bounds.endsAt, timezone);
  const totalMs = Math.max(new Date(end).getTime() - new Date(start).getTime(), HOUR_MS);
  const hourCount = Math.round(totalMs / HOUR_MS);
  const hourMarks = Array.from({ length: hourCount + 1 }, (_, index) =>
    new Date(new Date(start).getTime() + index * HOUR_MS).toISOString(),
  );
  const laneHeight = hourCount * PX_PER_HOUR;

  const offsetPct = (instant: string) => ((new Date(instant).getTime() - new Date(start).getTime()) / totalMs) * 100;
  const heightPct = (from: string, to: string) => ((new Date(to).getTime() - new Date(from).getTime()) / totalMs) * 100;

  return (
    <div className="mt-6 overflow-x-auto">
      <p className="mb-2 text-xs text-muted">
        Shaded time is that resource&rsquo;s own free time, and advisory (I6) — the exclusion
        constraint decides at the moment of booking.
      </p>
      <div className="flex" style={{ width: 'max-content' }}>
        <div className="w-14 shrink-0">
          <div className="h-8" aria-hidden />
          <div className="relative" style={{ height: `${laneHeight}px` }}>
            {hourMarks.map((mark, index) => (
              <div
                key={mark}
                className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-muted"
                style={{ top: `${(index / hourCount) * 100}%` }}
              >
                {formatHourLabel(mark, timezone)}
              </div>
            ))}
          </div>
        </div>

        {resources.map((entry) => (
          <div key={entry.resource.id} className="w-44 shrink-0 border-l border-border">
            <div className="flex h-8 items-end truncate px-2 pb-1 text-sm font-medium">{entry.resource.name}</div>
            <div className="relative border-t border-border" style={{ height: `${laneHeight}px` }}>
              {hourMarks.slice(1, -1).map((mark) => (
                <div
                  key={mark}
                  aria-hidden
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: `${offsetPct(mark)}%` }}
                />
              ))}

              {entry.free.map((window, index) => (
                <div
                  key={index}
                  aria-hidden
                  className="absolute inset-x-0.5 rounded bg-hover"
                  style={{ top: `${offsetPct(window.startsAt)}%`, height: `${heightPct(window.startsAt, window.endsAt)}%` }}
                />
              ))}

              {entry.booked.map((booking) => {
                // The appointment as it appears on *this* day — a booking that spans midnight
                // is clipped to the day's own bounds for geometry only; `booking.window` (the
                // canonical, unclipped appointment) still reaches `ScheduleEvent` for its full
                // description.
                const displayed = clipWindow(booking.window, within) ?? booking.window;
                return (
                  <ScheduleEvent
                    key={booking.workItemId}
                    organizationId={organizationId}
                    workItemId={booking.workItemId}
                    title={booking.title}
                    window={booking.window}
                    displayWindow={displayed}
                    timezone={timezone}
                    variant="block"
                    style={{
                      top: `${offsetPct(displayed.startsAt)}%`,
                      height: `${Math.max(heightPct(displayed.startsAt, displayed.endsAt), 2.5)}%`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
