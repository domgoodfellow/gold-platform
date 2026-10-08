import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button,ButtonLink } from '@/components/controls/button';
import { SelectInput } from '@/components/controls/inputs';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace';
import { FollowUpCalendar } from '@/features/crm/follow-ups/follow-up-calendar';
import { listFollowUps } from '@/lib/domain/follow-ups/follow-ups';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';
import { todayInZone,shiftDate,startOfMonth,zonedDayRange } from '@/lib/domain/scheduling/window';
import { calendarDates, parseCalendarView, parseCalendarDate } from '@/components/calendar/calendar-period';
import { workspaceAncestry } from '@/lib/navigation';
export const dynamic='force-dynamic';
export default async function FollowUpCalendarPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  const {organizationId}=await params; const q=await searchParams; const {db,organization}=await requireOrganization(organizationId);
  if(!await followUpsAvailable(db,organizationId))notFound();
  const today = todayInZone(organization.timezone);
  const view = parseCalendarView(q.view);
  const validOn = parseCalendarDate(q.on, today);
  const month = startOfMonth(validOn);
  const dates = calendarDates(view, validOn);
  const first = dates[0];
  const end = shiftDate(dates[dates.length - 1], 1);
  const [items,members]=await Promise.all([listFollowUps(db,{organizationId,from:zonedDayRange(first,organization.timezone).startsAt,before:zonedDayRange(end,organization.timezone).startsAt,ownerMembershipId:q.owner==='unassigned'?null:q.owner||undefined,limit:500}),listMembers(db,{organizationId})]);
  const options={organizationId,timezone:organization.timezone,members,mayManage:organization.capabilities.includes('follow_up.manage')};
  const base = `/organizations/${organizationId}/follow-ups`;
  return <AppPage className="flex h-full min-h-0 flex-1 flex-col">
    <CollectionHeader title="Follow-ups calendar" crumbs={workspaceAncestry(organizationId,'follow-up-calendar')} actions={<><ButtonLink href={base}>Follow-ups</ButtonLink>{options.mayManage?<FollowUpSheet {...options}/>:null}</>}/>
    <p className="mb-3 text-xs text-muted">{organization.timezone} · {items.total} follow-ups{items.total>items.length?' · Calendar preview limited to 500; use owner filters or the collection for all records.':''}</p>
    <CalendarWorkspace basePath={`${base}/calendar`} view={view} date={validOn} today={today} filters={q.owner ? {owner:q.owner} : {}}
      filterControls={<form method="get" className="flex flex-wrap gap-2">
        <input type="hidden" name="view" value={view}/><input type="hidden" name="on" value={validOn}/>
        <SelectInput aria-label="Owner" name="owner" defaultValue={q.owner??''}><option value="">All owners</option><option value="unassigned">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</SelectInput><Button type="submit">Apply</Button>
      </form>}
    >
      <FollowUpCalendar {...options} items={items} dates={dates} view={view} month={month} today={today} owner={q.owner}/>
    </CalendarWorkspace>
  </AppPage>;
}
