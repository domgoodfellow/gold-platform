import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import Link from 'next/link';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { getTypeBooking, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { requireOrganization } from '@/lib/route/organization';
import { WorkConfiguration } from '@/features/work/configuration/work-configuration';

export const dynamic = 'force-dynamic';

/**
 * How work behaves, apart from doing it.
 *
 * Moved out of the operational Work screen (product reality audit, Slice 3): a business scanning
 * today's jobs should not have to scroll past what a status means to reach them, and naming a new
 * kind of work is closer to Settings than to today's shift. Nothing here is a new calculation or
 * a new write path — every form is the one that always wrote these rows, just reached from where
 * defining a business now lives.
 *
 * Opening hours describe Schedule, not Work, and live at Settings → Schedule instead (product
 * architecture correction) — a business asking "when are we open" was never asking about a job's
 * type, workflow, checklist or fields, the four things this page is actually about.
 *
 * A detail route under Settings rather than an area of its own: `AreaTrail` already renders the
 * "‹ Settings" link for anything this deep, so this page writes its own heading the same way a
 * job's own page does (`ui-spec.md` — no heading on an area page, and this is not one).
 */
export default async function WorkConfigurationPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/work'>) {
  const { organizationId } = await params;
  const { type: requestedType } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  const types = await listWorkItemTypes(db, { organizationId });
  const selectedType = types.find((type) => type.id === requestedType) ?? types[0] ?? null;

  const [statuses, transitions, templateSteps, fieldDefinitions, prices, booking, enabledModules] = await Promise.all([
    selectedType
      ? listWorkItemStatuses(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve([]),
    selectedType
      ? listWorkItemTransitions(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve([]),
    selectedType
      ? listTypeChecklistItems(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve([]),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listPriceBookItems(db, { organizationId }),
    selectedType
      ? getTypeBooking(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve(null),
    listUsableModules(db, { organizationId }),
  ]);

  const mayConfigure = organization.capabilities.includes('field.manage');
  const bookingEnabled = enabledModules.has('booking');

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>Work</PageHeading>
      <Hint className="mt-1">
        The kinds of work this business does, the stages a job moves through, and the steps every
        job of a kind involves.{' '}
        <Link
          href={`/organizations/${organizationId}/work`}
          className="underline underline-offset-4"
        >
          Doing today&rsquo;s work
        </Link>{' '}
        happens on its own screen; this is where its shape is defined. The same configuration is
        also reachable from there, via Configure.
      </Hint>

      <div className="mt-6">
        <WorkConfiguration
          organizationId={organizationId}
          role={organization.role}
          mayConfigure={mayConfigure}
          types={types}
          selectedType={selectedType}
          statuses={statuses}
          transitions={transitions}
          templateSteps={templateSteps}
          fieldDefinitions={fieldDefinitions}
          prices={prices}
          booking={booking}
          bookingEnabled={bookingEnabled}
          typeHref={(typeId) => `/organizations/${organizationId}/settings/work?type=${typeId}`}
        />
      </div>
    </SettingsPageFrame>
  );
}
