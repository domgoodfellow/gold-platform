import { redirect } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { requireOrganization } from '@/lib/route/organization';
import { loadAutomationDashboard } from '@/lib/application/automations/dashboard';
import { AutomationDashboard } from '@/features/automations/workspace/dashboard';
import { areaHref } from '@/lib/navigation';

export const dynamic = 'force-dynamic';
export default async function AutomationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const first = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  if (first('view') === 'messages')
    redirect(areaHref(organizationId, 'automation-messages'));
  if (first('view') === 'activity')
    redirect(areaHref(organizationId, 'automation-activity'));
  const { db, organization } = await requireOrganization(organizationId);
  const data = await loadAutomationDashboard(db, {
    organizationId,
    timezone: organization.timezone,
    when: first('when'),
  });
  return (
    <AppPage>
      <AutomationDashboard
        organizationId={organizationId}
        timezone={organization.timezone}
        data={data}
        search={(first('q') ?? '').slice(0, 100)}
        mayManage={organization.capabilities.includes('automation.manage')}
        mayConfigure={organization.capabilities.includes('feature.manage')}
      />
    </AppPage>
  );
}
