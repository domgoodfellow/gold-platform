import { CalendarAgenda } from '@/components/calendar/calendar-boards';
import type { ScheduleDay } from '@/lib/domain/scheduling/availability';
import { dayEvents } from './day-events';
import { ScheduleEvent } from './schedule-event';

export function WeekSchedule({ organizationId, days, today, timezone, shortfalls }: {
  organizationId: string;
  days: ScheduleDay[];
  today: string;
  timezone: string;
  shortfalls: Readonly<Record<string, string>>;
}) {
  return <CalendarAgenda today={today} emptyLabel="Nothing scheduled." days={days.map(day => {
    const events = dayEvents(day);
    return { date: day.date, content: events.length ? <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {events.map(event => <li key={event.workItemId}><ScheduleEvent
        organizationId={organizationId}
        workItemId={event.workItemId}
        title={event.title}
        window={event.window}
        displayWindow={event.displayWindow}
        resourceName={event.resourceNames.length > 0 ? event.resourceNames.join(' · ') : 'Unassigned'}
        missing={shortfalls[event.workItemId]}
        availabilityNote={event.availabilityNote}
        timezone={timezone}
        variant="row"
      /></li>)}
    </ul> : null };
  })} />;
}
