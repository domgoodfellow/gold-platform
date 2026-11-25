import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button } from '@/components/controls/button';
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace';
import { calendarDates, parseCalendarView, parseCalendarDate } from '@/components/calendar/calendar-period';
import { EventSheet } from './event-sheet';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { OrganizationCalendar } from './organization-calendar';
import { loadOrganizationCalendar, parseCalendarSource } from '@/lib/application/calendar/organization-calendar';
import { calendarWorkspace, legacyCalendarHref } from '@/lib/application/calendar/navigation';
import { todayInZone, shiftDate, startOfMonth, zonedDayRange, localDateTimeToInstant } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';
import { WORKSPACES, areaHref, type WorkspaceKey } from '@/lib/navigation';
import { SelectField } from '@/components/controls/select-field';

export async function WorkspaceCalendarPage({params, searchParams, workspace}: {
  workspace: WorkspaceKey; params: Promise<{organizationId:string}>; searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const {organizationId}=await params;
  await requireOrganization(organizationId);
  return redirect(legacyCalendarHref(organizationId, workspace, await searchParams));
}

export async function SharedCalendarPage({params, searchParams}: {
  params: Promise<{organizationId:string}>; searchParams: Promise<Record<string,string|undefined>>;
}) {
  const {organizationId}=await params;
  const q=await searchParams;
  const {db,organization}=await requireOrganization(organizationId);
  const today=todayInZone(organization.timezone), view=parseCalendarView(q.view), date=parseCalendarDate(q.on,today);
  const workspace=calendarWorkspace(q.workspace), source=parseCalendarSource(q.source);
  const actor=await requireActor(db), dates=calendarDates(view,date);
  const data=await loadOrganizationCalendar(db,{organizationId,source,workspace,within:{
    startsAt:zonedDayRange(dates[0],organization.timezone).startsAt,
    endsAt:zonedDayRange(shiftDate(dates[dates.length-1],1),organization.timezone).startsAt,
  }});
  const calendarPath=areaHref(organizationId,'calendar');
  const filters={...(workspace?{workspace}:{}),...(source!=='all'?{source}:{})};
  const options={organizationId,timezone:organization.timezone,members:data.members,mayManage:data.mayManageTasks};
  // Only real conditions about what the board can show; an ordinary empty period is the empty board itself.
  const notices=[...(source==='follow-ups'&&!data.tasksAvailable?['CRM tasks are unavailable for this business.']:[]),...data.notices];
  return <AppPage fill>
    <CollectionHeader location={{}}/>
    <CalendarWorkspace basePath={calendarPath} view={view} date={date} today={today} timezone={organization.timezone} filters={filters}
      actions={<EventSheet organizationId={organizationId} workspace={workspace} timezone={organization.timezone} startsAt={localDateTimeToInstant(`${date}T09:00`,organization.timezone)}/>}
      notices={notices.length?<div className="flex flex-col gap-1">{notices.map(notice=><p key={notice} role="status" className="text-sm text-muted">{notice}</p>)}</div>:null}
      filterControls={<form method="get" className="flex flex-wrap items-center gap-2" aria-label="Filter the calendar">
        <input type="hidden" name="view" value={view}/><input type="hidden" name="on" value={date}/>
        <SelectField aria-label="Calendar workspace" name="workspace" defaultValue={workspace??''} options={[{value:'',label:'All workspaces'},...WORKSPACES.map(item=>({value:item.key,label:item.label}))]}/>
        <SelectField aria-label="Calendar sources" name="source" defaultValue={source} options={[{value:'all',label:'All sources'},{value:'events',label:'Calendar events'},{value:'follow-ups',label:'CRM tasks',disabled:!data.tasksAvailable},{value:'work',label:'Scheduled Work'}]}/>
        <Button type="submit" tone="secondary">Apply</Button>
      </form>}>
      <OrganizationCalendar selectedDate={date} workspace={workspace} actorId={actor.id} mayManageCalendar={organization.capabilities.includes('organization.manage')} basePath={calendarPath} {...options} events={data.events} dates={dates} view={view} month={startOfMonth(date)} today={today} filters={filters}/>
    </CalendarWorkspace>
  </AppPage>;
}
