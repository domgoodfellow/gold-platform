import Link from 'next/link';
import { CalendarAgenda, CalendarMonth } from '@/components/calendar/calendar-boards';
import { calendarHref, type CalendarFilters, type CalendarView } from '@/components/calendar/calendar-workspace';
import { eventsOnDate, type OrganizationCalendarEvent } from '@/lib/application/calendar/organization-calendar';
import { FollowUpSheet, type FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';

export function OrganizationCalendar({ events, dates, view, month, today, filters, ...options }: FollowUpOptions & {
  events: OrganizationCalendarEvent[]; dates: string[]; view: CalendarView; month: string; today: string; filters: CalendarFilters;
}) {
  const base = `/organizations/${options.organizationId}`;
  const time = new Intl.DateTimeFormat('en-CA', { timeZone: options.timezone, hour: 'numeric', minute: '2-digit' });
  const title = (event: OrganizationCalendarEvent) => event.source === 'follow-ups'
    ? <FollowUpSheet {...options} item={event.followUp}>{event.title}</FollowUpSheet>
    : <Link href={`${base}/work/${event.workId}`} className="font-medium hover:underline">{event.title}</Link>;
  if (view === 'month') return <CalendarMonth monthDate={month} today={today} days={dates.map(date => ({
    date, href: calendarHref(`${base}/calendar`, 'day', date, filters),
    entries: eventsOnDate(events, date, options.timezone).map(event => ({ id: event.key, content: <>
      <span className="mr-1">{event.source === 'work' ? 'Work' : 'Follow-up'} ·</span>{title(event)}
    </> })),
  }))} />;
  return <CalendarAgenda today={today} emptyLabel="No scheduled items." days={dates.map(date => {
    const entries = eventsOnDate(events, date, options.timezone);
    return { date, content: entries.length ? <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {entries.map(event => <li key={event.key} className="rounded-md border-l-2 border-foreground bg-surface p-2">
        <p className="mb-1 text-xs text-muted">{time.format(new Date(event.startsAt))}{event.endsAt ? ` – ${time.format(new Date(event.endsAt))}` : ''}</p>
        {title(event)}
        <p className="mt-1 text-xs text-muted">{event.source === 'work' ? 'Work' : `Follow-up · ${event.followUp.kind}`} · {event.status}</p>
        {event.context ? <p className="mt-1 break-words text-xs text-muted">{event.context}</p> : null}
      </li>)}
    </ul> : null };
  })} />;
}
