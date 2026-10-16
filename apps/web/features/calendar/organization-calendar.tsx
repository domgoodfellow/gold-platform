import type { WorkspaceKey } from '@/lib/navigation';
import { EventSheet } from './event-sheet';
import { CalendarTimeGrid } from './time-grid';
import Link from 'next/link';
import { CalendarMonth } from '@/components/calendar/calendar-boards';
import { calendarHref, type CalendarFilters, type CalendarView } from '@/components/calendar/calendar-workspace';
import { eventsOnDate, type OrganizationCalendarEvent } from '@/lib/application/calendar/organization-calendar';
import { FollowUpSheet, type FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';

export function OrganizationCalendar({ events, dates, view, month, today, filters, basePath, workspace, actorId, mayManageCalendar, selectedDate, ...options }: FollowUpOptions & {
  selectedDate: string; workspace: WorkspaceKey; actorId: string; mayManageCalendar: boolean; basePath: string; events: OrganizationCalendarEvent[]; dates: string[]; view: CalendarView; month: string; today: string; filters: CalendarFilters;
}) {
  const base = `/organizations/${options.organizationId}`;
  const title = (event: OrganizationCalendarEvent) => event.source === 'follow-ups'
    ? <FollowUpSheet {...options} item={event.followUp}>{event.title}</FollowUpSheet>
    : event.source === 'calendar' ? <EventSheet organizationId={options.organizationId} workspace={workspace} timezone={options.timezone} event={event.event} startsAt={event.startsAt} mayEdit={event.event.createdBy === actorId || mayManageCalendar}>{event.title}</EventSheet>
    : <Link href={`${base}/work/${event.workId}`} className="font-medium hover:underline">{event.title}</Link>;
  if (view === 'month') return <CalendarMonth monthDate={month} today={today} days={dates.map(date => ({
    date, href: calendarHref(basePath, 'day', date, filters),
    entries: eventsOnDate(events, date, options.timezone).map(event => ({ id: event.key, content: <>
      <span className="mr-1">{event.source === 'work' ? 'Work' : event.source === 'calendar' ? 'Event' : event.followUp.kind} ·</span>{title(event)}
    </> })),
  }))} />;
  return <CalendarTimeGrid focusDate={selectedDate} events={events} dates={dates} timezone={options.timezone} organizationId={options.organizationId} workspace={workspace} renderEvent={title}/>;
}
