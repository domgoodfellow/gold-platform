import Link from 'next/link';
import { FOCUS_RING } from '@/components/class-names';
import { CompactEmptyState, OperationalPanel } from '@/components/operational/primitives';
import { loadOrganizationCalendar, type OrganizationCalendarEvent } from '@/lib/application/calendar/organization-calendar';
import type { Db } from '@/lib/db/types';
import { todayInZone, shiftDate, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaHref } from '@/lib/navigation';

/** A bounded CRM projection of the existing calendar, never a scheduling authority. */
export async function CrmCalendarAgenda({ db, organizationId, timezone }: { db: Db; organizationId: string; timezone: string }) {
  const now = new Date();
  const today = todayInZone(timezone, now);
  const data = await loadOrganizationCalendar(db, { organizationId, source: 'follow-ups', workspace: 'crm', taskStatus: 'open', within: {
    startsAt: now.toISOString(), endsAt: zonedDayRange(shiftDate(today, 7), timezone).startsAt,
  } });
  return <CalendarAgenda organizationId={organizationId} timezone={timezone} today={today} events={data.events} notices={data.notices}/>;
}

export function CalendarAgenda({ organizationId, timezone, today, events, notices }: {
  organizationId: string; timezone: string; today: string; events: OrganizationCalendarEvent[]; notices: string[];
}) {
  const path = areaHref(organizationId, 'calendar');
  const dayHref = (date: string) => `${path}?view=day&on=${date}&scope=workspace`;
  const dateTime = new Intl.DateTimeFormat('en', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const time = new Intl.DateTimeFormat('en', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  return <OperationalPanel title="Upcoming calendar" density="compact" href={dayHref(today)} hrefLabel="Open Calendar" meta={<span className="text-xs text-muted">Next 7 days ({timezone})</span>}>
    {notices.map(notice => <p key={notice} role="status" className="mb-2 text-sm text-muted">{notice}</p>)}
    {events.length ? <ul className="divide-y divide-border">{events.slice(0, 5).map(event => {
      const date = todayInZone(timezone, new Date(event.startsAt));
      return <li key={event.key}>
      <Link href={dayHref(date < today ? today : date)} className={`block min-w-0 rounded px-1 py-2 hover:bg-hover ${FOCUS_RING}`}>
        <span className="block break-words text-sm font-medium">{event.title}</span>
        <span className="block text-xs text-muted">{event.source === 'follow-ups' ? 'Due ' : ''}<time dateTime={event.startsAt}>{dateTime.format(new Date(event.startsAt))}</time>{event.endsAt ? <> to <time dateTime={event.endsAt}>{date === todayInZone(timezone, new Date(event.endsAt)) ? time.format(new Date(event.endsAt)) : dateTime.format(new Date(event.endsAt))}</time></> : null}</span>
        {event.context ? <span className="block break-words text-xs text-muted">{event.context}</span> : null}
      </Link>
    </li>;
    })}</ul> : notices.length ? <CompactEmptyState kind="unavailable">Calendar preview unavailable. Open Calendar to retry.</CompactEmptyState> : <CompactEmptyState>No upcoming CRM events or tasks in the next 7 days.</CompactEmptyState>}
    {events.length > 5 ? <p className="mt-2 text-xs text-muted">Showing the next 5. Open Calendar for more.</p> : null}
  </OperationalPanel>;
}
