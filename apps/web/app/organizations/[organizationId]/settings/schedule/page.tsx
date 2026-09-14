import { DividedList, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import Link from 'next/link';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { requireOrganization } from '@/lib/route/organization';
import { AddOperatingHoursForm, OperatingHoursRow } from '../settings-forms';

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

      <Section className="mt-6">
        <SectionHeading>Opening hours</SectionHeading>
        <Hint className="mt-1">
          {hours.length === 0
            ? 'No opening hours set, so the schedule treats every hour as available. Nothing here is assumed — which days this business works, and when, are yours to say.'
            : `Times are read in ${organization.timezone}.`}
        </Hint>

        {hours.length > 0 ? (
          <DividedList as="div" className="mt-2">
            {hours.map((entry) =>
              mayConfigure ? (
                <OperatingHoursRow key={entry.id} organizationId={organizationId} hours={entry} />
              ) : (
                <Hint key={entry.id} className="py-2">
                  {entry.opensAt.slice(0, 5)}–{entry.closesAt.slice(0, 5)}
                </Hint>
              ),
            )}
          </DividedList>
        ) : null}

        {mayConfigure ? (
          <AddOperatingHoursForm organizationId={organizationId} />
        ) : (
          <Hint className="mt-2">Your role, {organization.role}, cannot set opening hours.</Hint>
        )}
      </Section>
    </SettingsPageFrame>
  );
}
