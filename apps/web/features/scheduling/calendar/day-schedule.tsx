import { ButtonLink } from '@/components/controls/button';
import type { ResourceSchedule, UnassignedWork } from '@/lib/domain/scheduling/availability';
import { clipWindow, todayInZone, type Window } from '@/lib/domain/scheduling/window';
import { availabilityNote } from './availability-note';
import {
  computeDisplayAxisBounds,
  hourMarksFor,
  makeAxisScale,
  PX_PER_HOUR,
} from './calendar-geometry';
import { formatHourLabel } from '@/components/calendar/calendar-format';
import { ScheduleEvent } from './schedule-event';

/** The lane header row's own height (`h-9`, every lane and the time rail alike) — what the "now" line's pixel offset has to clear before the hour axis itself begins. */
const LANE_HEADER_PX = 36;

/**
 * "What is each Resource doing today, and when?" — a time axis on the left, one lane per visible
 * Resource. Because the exclusion constraint already refuses two bookings on one Resource at
 * once, a lane never has to lay out an overlap: every booking gets its own absolutely-positioned
 * block, offset and sized from its real instants, and nothing here recomputes whether two of them
 * collide.
 *
 * The board itself is never replaced by prose (`CLAUDE.md`'s empty-state rules): zero Resources,
 * zero bookings and hours not yet set each change what is drawn *inside* the grid, never whether
 * the grid exists. Two different states, never mixed: no opening hours set for the business at
 * all ("No opening hours yet", with a link to set them), and hours set but none on this day
 * ("Closed", every lane shaded).
 */

export function DaySchedule({
  organizationId,
  date,
  within,
  open,
  resources,
  unassigned,
  resourceNames,
  shortfalls,
  hasConfiguredHours,
  timezone,
  resourcesHref,
  mayAddResource,
  hoursHref = null,
}: {
  organizationId: string;
  date: string;
  /** This tenant calendar day's own bounds (`ScheduleDay.within`) — what a booking's display window is clipped to. */
  within: Window;
  /** This day's own open periods, from `ScheduleDay.open`. */
  open: Window[];
  resources: ResourceSchedule[];
  /** Work scheduled this day with nobody on it — drawn as its own lane, because it holds no resource's time. */
  unassigned: UnassignedWork[];
  /** Every resource's name by id, so a lane can say who else is on a job even when the board is filtered to one lane. */
  resourceNames: ReadonlyMap<string, string>;
  /** What each scheduled job is short of, by work item id — only jobs that are short appear. */
  shortfalls: Readonly<Record<string, string>>;
  /** Whether this business has set opening hours for any day at all. */
  hasConfiguredHours: boolean;
  timezone: string;
  resourcesHref: string;
  mayAddResource: boolean;
  /** The opening-hours editor, for someone who may change hours; otherwise no link is offered. */
  hoursHref?: string | null;
}) {
  const { bounds } = computeDisplayAxisBounds({
    date,
    timeZone: timezone,
    within,
    open,
    resources,
    unassigned,
    hasConfiguredHours,
  });
  const { marks: hourMarks, hourCount } = hourMarksFor(bounds);
  const laneHeight = hourCount * PX_PER_HOUR;
  const { offsetPct, heightPct } = makeAxisScale(bounds);

  const closedDay = hasConfiguredHours && open.length === 0;

  // The "now" line — a presentation-only marker, drawn only on the day actually being viewed and
  // only when the current instant falls inside the axis being drawn; it asserts nothing about
  // availability and reads no state back.
  const now = new Date().toISOString();
  const showNowLine = date === todayInZone(timezone) && now >= bounds.startsAt && now <= bounds.endsAt;
  const nowTopPx = LANE_HEADER_PX + (offsetPct(now) / 100) * laneHeight;

  // A closed day is shaded across every lane, so "closed" is drawn as well as said.
  const laneShade = closedDay ? ' bg-hover/60' : '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {closedDay ? (
        <div role="status" className="border-b border-border bg-hover/60 px-3 py-1.5 text-xs text-muted">Closed</div>
      ) : !hasConfiguredHours ? (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-xs text-muted">
          <span>No opening hours yet</span>
          {hoursHref ? <ButtonLink href={hoursHref} size="small" tone="text">Set hours</ButtonLink> : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {/*
          `h-full` here is what lets every lane below stretch to fill the canvas rather than
          sizing to its own hour count: each lane sets `minHeight` (never `height`), so the
          default flex cross-axis stretch makes it exactly this row's height — which is the full
          canvas — whenever that is taller than the hour axis needs, and the hour axis's own
          floor otherwise, with the scroll container above taking over for the overflow.
        */}
        <div className="relative flex h-full min-w-full">
          {showNowLine ? (
            <div
              aria-hidden
              className="pointer-events-none absolute left-14 right-0 z-20 flex items-center"
              style={{ top: `${nowTopPx}px` }}
            >
              <span className="-ml-1 size-2 shrink-0 rounded-full bg-accent" />
              <span className="h-px flex-1 bg-accent" />
            </div>
          ) : null}

          <div className="sticky left-0 z-10 flex h-full w-14 shrink-0 flex-col bg-background">
            <div className="h-9 shrink-0" aria-hidden />
            <div className="relative flex-1" style={{ minHeight: `${laneHeight}px` }}>
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

          {resources.length === 0 ? (
            <div className="flex min-w-0 flex-1 flex-col border-l border-border">
              <div className="h-9 shrink-0" aria-hidden />
              <div
                className={`relative flex flex-1 items-center justify-center border-t border-border${laneShade}`}
                style={{ minHeight: `${laneHeight}px` }}
              >
                <div className="flex flex-col items-center gap-2 px-6 text-center">
                  <p className="text-sm font-medium">No resources yet</p>
                  <p className="max-w-xs text-xs text-muted">
                    Add a technician, vehicle, room or equipment Resource to schedule work against.
                  </p>
                  {mayAddResource ? (
                    <ButtonLink href={resourcesHref} size="small" className="mt-1">
                      Add resource
                    </ButtonLink>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            resources.map((entry) => (
              <div key={entry.resource.id} className="flex min-w-44 flex-1 basis-44 flex-col border-l border-border">
                <div className="flex h-9 shrink-0 items-end truncate px-2 pb-1 text-sm font-medium">
                  {entry.resource.name}
                  <span className="sr-only">
                    {entry.open.length === 0
                      ? ', not working this day'
                      : `, working ${entry.open.map((window) => `${formatHourLabel(window.startsAt, timezone)} to ${formatHourLabel(window.endsAt, timezone)}`).join(' and ')}`}
                  </span>
                </div>
                <div className={`relative flex-1 border-t border-border${laneShade}`} style={{ minHeight: `${laneHeight}px` }}>
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

                  {/* Time off and maintenance, drawn as what it is — text on a hatched block, so
                      "not working" is never carried by shading alone and never looks like a job. */}
                  {entry.exceptions.map((exception) => {
                    const shown = clipWindow(exception.window, within);
                    if (!shown) return null;
                    return (
                      <div
                        key={exception.id}
                        className="absolute inset-x-0.5 overflow-hidden rounded border border-dashed border-border bg-background/80 px-1.5 py-1 text-xs leading-tight text-muted"
                        style={{ top: `${offsetPct(shown.startsAt)}%`, height: `${heightPct(shown.startsAt, shown.endsAt)}%` }}
                      >
                        <span className="sr-only">{`${entry.resource.name} is unavailable: ${exception.reason ?? 'time off'}`}</span>
                        <span aria-hidden className="block truncate">Unavailable{exception.reason ? ` — ${exception.reason}` : ''}</span>
                      </div>
                    );
                  })}

                  {entry.booked.map((booking) => {
                    // The appointment as it appears on *this* day — a booking that spans
                    // midnight is clipped to the day's own bounds for geometry only;
                    // `booking.window` (the canonical, unclipped appointment) still reaches
                    // `ScheduleEvent` for its full description.
                    const displayed = clipWindow(booking.window, within) ?? booking.window;
                    return (
                      <ScheduleEvent
                        key={booking.workItemId}
                        organizationId={organizationId}
                        workItemId={booking.workItemId}
                        title={booking.title}
                        window={booking.window}
                        displayWindow={displayed}
                        alsoWith={booking.resourceIds
                          .filter((id) => id !== entry.resource.id)
                          .map((id) => resourceNames.get(id) ?? 'Another resource')}
                        missing={shortfalls[booking.workItemId]}
                        availabilityNote={availabilityNote(booking.availabilityProblem, entry.resource.name)}
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
            ))
          )}

          {/* Scheduled work nobody is on. It takes no resource's time, so it is not in anybody's lane
              and not shaded as availability — it is on the board and says so, which is all this is. */}
          {unassigned.length > 0 ? (
            <div className="flex min-w-44 flex-1 basis-44 flex-col border-l border-border">
              <div className="flex h-9 shrink-0 items-end truncate px-2 pb-1 text-sm font-medium">Unassigned</div>
              <div className={`relative flex-1 border-t border-border${laneShade}`} style={{ minHeight: `${laneHeight}px` }}>
                {hourMarks.slice(1, -1).map((mark) => (
                  <div
                    key={mark}
                    aria-hidden
                    className="absolute inset-x-0 border-t border-border/60"
                    style={{ top: `${offsetPct(mark)}%` }}
                  />
                ))}
                {unassigned.map((work) => {
                  const displayed = clipWindow(work.window, within) ?? work.window;
                  return (
                    <ScheduleEvent
                      key={work.workItemId}
                      organizationId={organizationId}
                      workItemId={work.workItemId}
                      title={work.title}
                      window={work.window}
                      displayWindow={displayed}
                      resourceName="Unassigned"
                      missing={shortfalls[work.workItemId]}
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
