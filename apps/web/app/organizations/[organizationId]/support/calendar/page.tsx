import { WorkspaceCalendarPage } from '@/features/calendar/workspace-calendar-page';

export const dynamic = 'force-dynamic';

export default async function CalendarPage(props: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <WorkspaceCalendarPage {...props} workspace='support'/>;
}
