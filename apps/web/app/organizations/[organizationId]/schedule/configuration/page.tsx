import Link from 'next/link';
import { PageHeader } from '@/components/headers/page-header';
import { areaLabel } from '@/lib/navigation';

import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { ScheduleConfiguration } from '@/features/scheduling/configuration/schedule-configuration';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Schedule's own configuration route: opening hours used by availability. */
export default async function ScheduleConfigurationPage({
  params,
}: PageProps<'/organizations/[organizationId]/schedule/configuration'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const hours = await listOperatingHours(db, { organizationId });
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <SettingsPageFrame>
      <PageHeader title="Schedule configuration" crumbs={[{ label: areaLabel('schedule'), href: `/organizations/${organizationId}/schedule` }]} />
      <Hint className="mt-1">
        Opening hours used by the{' '}
        <Link href={`/organizations/${organizationId}/schedule`} className="underline underline-offset-4">
          schedule
        </Link>{' '}
        to work out what is free.
      </Hint>

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
