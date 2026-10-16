import type { ReactNode } from 'react';
import { CalendarTimeViewport } from '@/components/calendar/calendar-time-viewport';
import { layoutTimeBlocks } from '@/components/calendar/calendar-time-layout';
import { eventsOnDate, type OrganizationCalendarEvent } from '@/lib/application/calendar/organization-calendar';
import { zonedDayRange } from '@/lib/domain/scheduling/window';
import type { WorkspaceKey } from '@/lib/navigation';
import { EventSheet } from './event-sheet';

export function CalendarTimeGrid({ events, dates, timezone, organizationId, workspace, renderEvent, focusDate }: {
  events: OrganizationCalendarEvent[]; dates: string[]; timezone: string; organizationId: string; workspace: WorkspaceKey; focusDate: string;
  renderEvent: (event: OrganizationCalendarEvent) => ReactNode;
}) {
  const hour = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const hourMark = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric' });
  const heading = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const days = dates.map(date => {
    const range = zonedDayRange(date, timezone);
    const from = Date.parse(range.startsAt), before = Date.parse(range.endsAt);
    return { date, from, before, hours: (before - from) / 3600000, entries: eventsOnDate(events, date, timezone) };
  });
  return <CalendarTimeViewport period={dates.join(',')} columns={dates.length} focusColumn={Math.max(0, dates.indexOf(focusDate))}>
    <div className="grid min-w-full" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(${days.length > 1 ? '10rem' : '16rem'}, 1fr))` }}>
      {days.map(day => <section key={day.date} aria-label={day.date} className="min-w-0 border-r border-border last:border-r-0">
        <h2 className="sticky top-0 z-20 border-b border-border bg-background px-3 py-2 text-sm font-medium">{heading.format(new Date(`${day.date}T12:00:00Z`))}</h2>
        <div className="relative" style={{ height: day.hours * 96 }}>
          {Array.from({ length: Math.ceil(day.hours * 2) }, (_, index) => {
            const instant = new Date(day.from + index * 30 * 60000).toISOString();
            return <div key={instant} className="absolute inset-x-0 h-12 border-t border-border/60" style={{ top: index * 48 }}>
              {index % 2 === 0 ? <span className="pointer-events-none absolute left-1 top-0 z-10 bg-background/90 text-[10px] text-muted">{hourMark.format(new Date(instant))}</span> : null}
              <EventSheet organizationId={organizationId} workspace={workspace} timezone={timezone} startsAt={instant} slot>
                <span className="sr-only">Add event {day.date} {hour.format(new Date(instant))}</span>
              </EventSheet>
            </div>;
          })}
          {layoutTimeBlocks(day.entries, day.from, day.before).map(block => {
            const event = day.entries.find(item => item.key === block.key)!;
            return <div key={block.key} className="absolute z-10 overflow-auto rounded border border-accent/30 bg-surface p-1.5 text-xs shadow-sm"
              style={{ top: (block.start - day.from) / 3600000 * 96, height: Math.max(30, (block.end - block.start) / 3600000 * 96), left: `calc(3rem + (100% - 3rem) * ${block.column / block.columns})`, width: `calc((100% - 3rem) / ${block.columns} - 3px)` }}>
              {renderEvent(event)}
              <p className="mt-1 text-[10px] text-muted">{event.endsAt ? `${hour.format(new Date(event.startsAt))} – ${hour.format(new Date(event.endsAt))}` : `Due ${hour.format(new Date(event.startsAt))}`}</p>
            </div>;
          })}
        </div>
      </section>)}
    </div>
  </CalendarTimeViewport>;
}
