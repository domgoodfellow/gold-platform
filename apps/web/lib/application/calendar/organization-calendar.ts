import { listCalendarEvents, type CalendarEvent } from '@/lib/domain/calendar/events';
import type { WorkspaceKey } from '@/lib/navigation';
import type { Db } from '@/lib/db/types';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';
import { listFollowUps, type FollowUp } from '@/lib/domain/follow-ups/follow-ups';
import { listMembers, type Member } from '@/lib/domain/tenancy/members';
import { listWorkItems, type WorkItem } from '@/lib/domain/work-items/work-items';
import { zonedDayRange, type Window } from '@/lib/domain/scheduling/window';

export type CalendarSource = 'all' | 'follow-ups' | 'work' | 'events';
export function parseCalendarSource(value?: string): CalendarSource {
  return value === 'follow-ups' || value === 'work' ? value : 'all';
}
export type OrganizationCalendarEvent = {
  key: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  context: string;
  status: string;
} & ({ source: 'follow-ups'; followUp: FollowUp } | { source: 'work'; workId: string } | { source: 'calendar'; event: CalendarEvent });

export function calendarEvents(followUps: FollowUp[], work: WorkItem[]): OrganizationCalendarEvent[] {
  const events: OrganizationCalendarEvent[] = followUps.map(item => ({
    key: `follow-up:${item.id}`, source: 'follow-ups', title: item.title, startsAt: item.dueAt,
    context: [item.customerName, item.opportunityTitle, item.ownerName].filter(Boolean).join(' · '),
    status: item.status, followUp: item,
  }));
  for (const item of work) if (item.window) events.push({
    key: `work:${item.id}`, source: 'work', title: item.title, startsAt: item.window.startsAt,
    endsAt: item.window.endsAt, context: [item.customer?.label, ...item.resources.map(r => r.label)].filter(Boolean).join(' · '),
    status: item.status.label, workId: item.id,
  });
  return events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key));
}

export function eventsOnDate(events: OrganizationCalendarEvent[], date: string, timezone: string) {
  const day = zonedDayRange(date, timezone);
  const from = Date.parse(day.startsAt), before = Date.parse(day.endsAt);
  return events.filter(event => event.endsAt
    ? Date.parse(event.startsAt) < before && Date.parse(event.endsAt) > from
    : Date.parse(event.startsAt) >= from && Date.parse(event.startsAt) < before);
}

export async function loadOrganizationCalendar(db: Db, input: {
  organizationId: string; within: Window; source: CalendarSource; owner?: string; workspace?: WorkspaceKey;
}) {
  const notices: string[] = [];
  let members: Member[] = [];
  let followUpsEnabled = false;
  const [crm, work, native] = await Promise.allSettled([
    (async () => {
      if (input.source !== 'all' && input.source !== 'follow-ups') return [];
      followUpsEnabled = await followUpsAvailable(db, input.organizationId);
      if (!followUpsEnabled) return [];
      const [items, owners] = await Promise.all([
        listFollowUps(db, { organizationId: input.organizationId, from: input.within.startsAt,
          before: input.within.endsAt, ownerMembershipId: input.owner === 'unassigned' ? null : input.owner || undefined, limit: 500 }),
        listMembers(db, { organizationId: input.organizationId }),
      ]);
      members = owners;
      if (items.exactCount === null || items.total > items.length) notices.push('Follow-ups preview may be incomplete. Choose a shorter period or open Follow-ups for all records.');
      return items;
    })(),
    input.source !== 'all' && input.source !== 'work' ? Promise.resolve([]) : listWorkItems(db, {
      organizationId: input.organizationId, within: input.within, scheduled: true, sort: 'schedule', limit: 500,
    }).then(items => {
      if (items.exactCount === null || items.total > items.length) notices.push('Scheduled work preview may be incomplete. Choose a shorter period or open Schedule for all records.');
      return items;
    }),
    listCalendarEvents(db, { organizationId: input.organizationId, within: input.within, workspace: input.workspace }),
  ]);
  if (native.status === 'rejected') notices.push('Calendar events are unavailable.');
  else if (native.value.exactCount === null || native.value.total > native.value.length) notices.push('Event preview is limited. Choose a shorter period to see all events.');
  if (crm.status === 'rejected') notices.push('Follow-ups are unavailable. Other calendar sources may still be shown.');
  if (work.status === 'rejected') notices.push('Scheduled work is unavailable. Other calendar sources may still be shown.');
  const events = calendarEvents(crm.status === 'fulfilled' ? crm.value : [], work.status === 'fulfilled' ? work.value : []);
  if (native.status === 'fulfilled') for (const event of native.value) events.push({ key: `event:${event.id}`, source: 'calendar', event, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, context: '', status: event.status });
  events.sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key));
  return { events,
    notices, members, followUpsEnabled };
}
