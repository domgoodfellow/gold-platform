import { PageHeader } from '@/components/headers/page-header';
import { areaLabel } from '@/lib/navigation';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { ScheduleConfiguration } from '@/features/scheduling/configuration/schedule-configuration';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/** Schedule's own configuration route: opening hours used by availability. */
export default async function ScheduleConfigurationPage({
  params,
}: PageProps<'/organizations/[organizationId]/schedule/configuration'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireConfigurationTarget(organizationId, 'schedule-configuration');

  const hours = await listOperatingHours(db, { organizationId });
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <SettingsPageFrame>
      <PageHeader title="Schedule configuration" crumbs={[{ label: areaLabel('schedule'), href: `/organizations/${organizationId}/schedule` }]} />
      <div className="mt-6">
        <ScheduleConfiguration
          organizationId={organizationId}
          role={organization.role}
          mayConfigure={mayConfigure}
          hours={hours}
          timezone={organization.timezone}
          bufferMinutes={organization.bufferMinutes}
        />
      </div>
    </SettingsPageFrame>
  );
}
