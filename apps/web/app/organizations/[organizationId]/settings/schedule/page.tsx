import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import Link from 'next/link';
import { ScheduleConfiguration } from '@/features/scheduling/configuration/schedule-configuration';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * When this business is open — the input `freeWindows` (I5) reads before it decides what's free.
 * Split out of Settings → Work (product architecture correction): opening hours describe
 * Schedule, not a job's type, workflow, checklist or fields.
 *
 * A detail route under Settings rather than an area of its own — `AreaTrail` renders the
 * "‹ Settings" link for anything this deep, so this page writes its own heading the same way
 * Settings → Work's does.
 */
export default async function ScheduleConfigurationPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/schedule'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const hours = await listOperatingHours(db, { organizationId });
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>Schedule</PageHeading>
      <Hint className="mt-1">
        When this business is open. Used by the{' '}
        <Link
          href={`/organizations/${organizationId}/schedule`}
          className="underline underline-offset-4"
        >
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
        />
      </div>
    </SettingsPageFrame>
  );
}
