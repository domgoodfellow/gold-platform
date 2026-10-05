import Link from 'next/link';
import { PageHeader } from '@/components/headers/page-header';
import { areaLabel } from '@/lib/navigation';

import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { WorkConfiguration } from '@/features/work/configuration/work-configuration';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResourceCapabilities } from '@/lib/domain/resources/resource-capabilities';
import { listResourceRequirements } from '@/lib/domain/work-items/requirements';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { getTypeBooking, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Work's own configuration route: job types, stages, moves, checklist templates, and booking. */
export default async function WorkConfigurationPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/work/configuration'>) {
  const { organizationId } = await params;
  const { type: requestedType } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  const types = await listWorkItemTypes(db, { organizationId });
  const selectedType = types.find((type) => type.id === requestedType) ?? types[0] ?? null;

  const [statuses, transitions, templateSteps, fieldDefinitions, prices, booking, enabledModules, requirements, capabilities] = await Promise.all([
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
    selectedType
      ? listResourceRequirements(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve([]),
    listResourceCapabilities(db, { organizationId }),
  ]);

  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <SettingsPageFrame>
      <PageHeader title="Work configuration" crumbs={[{ label: areaLabel('work'), href: `/organizations/${organizationId}/work` }]} />
      <Hint className="mt-1">
        The kinds of work this business does, the stages a job moves through, and the steps every
        job of a kind involves.{' '}
        <Link href={`/organizations/${organizationId}/work`} className="underline underline-offset-4">
          Doing today&rsquo;s work
        </Link>{' '}
        stays on the Work screen.
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
          bookingEnabled={enabledModules.has('booking')}
          requirements={requirements}
          capabilities={capabilities}
          typeHref={(typeId) => `/organizations/${organizationId}/work/configuration?type=${typeId}`}
        />
      </div>
    </SettingsPageFrame>
  );
}
