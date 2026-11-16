import { SharedCalendarPage } from '@/features/calendar/workspace-calendar-page';
import { requireOrganization } from '@/lib/route/organization';
export const dynamic='force-dynamic';
export default async function CalendarPage(props:{params:Promise<{organizationId:string}>;searchParams:Promise<Record<string,string|undefined>>}) {
  await requireOrganization((await props.params).organizationId);
  return <SharedCalendarPage {...props}/>;
}
