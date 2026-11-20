import { PageHeader } from '@/components/headers/page-header';
import { NewWorkAction } from '@/features/work/new-work-action';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { setupStepKey } from '@/lib/route/setup-context';

import { AppPage } from '@/components/layout/app-page';
import { WorkConfiguration } from '@/features/work/configuration/work-configuration';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResourceCapabilities } from '@/lib/domain/resources/resource-capabilities';
import { listResourceRequirements } from '@/lib/domain/work-items/requirements';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { listBookingIntakeForms } from '@/lib/domain/booking/intake';
import { getTypeBooking, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
import { areaAvailable } from '@/lib/navigation';
import { loadTypeEconomics } from '@/lib/application/finance/expected-economics';

export const dynamic = 'force-dynamic';

/** Work's own configuration route: job types, stages, moves, checklist templates, and booking. */
export default async function WorkConfigurationPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/work/configuration'>) {
  const { organizationId } = await params;
  const { type: requestedType, tab: requestedTab, new: requestedNew, returnTo, quote, setupStep } = await searchParams;
  const step = setupStepKey(typeof setupStep === 'string' ? setupStep : undefined);
  const context = new URLSearchParams();
  if (returnTo === 'create') context.set('returnTo', 'create');
  if (quote === '1') context.set('quote', '1');
  if (step) context.set('setupStep', step);
  const listHref = `/organizations/${organizationId}/work/configuration${context.size ? `?${context}` : ''}`;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'work-configuration');

  const types = await listWorkItemTypes(db, { organizationId, includeArchived: true });
  // Fields belong to all work, not to one type: `?tab=fields` opens them on their own.
  const fieldsOpen = requestedTab === 'fields';
  const selectedType = fieldsOpen ? null : types.find((type) => type.id === requestedType) ?? types[0] ?? null;
  const has = (capability: (typeof organization.capabilities)[number]) => organization.capabilities.includes(capability);
  const sells = areaAvailable('finance-catalog', { ...gate, enabled: gate.enabledModules });

  const [statuses, transitions, templateSteps, fieldDefinitions, prices, booking, enabledModules, requirements, capabilities, intakeForms] = await Promise.all([
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
    listBookingIntakeForms(db, { organizationId }),
  ]);

  const pricing = selectedType && sells
    ? {
        ...(await loadTypeEconomics(db, { organizationId, typeId: selectedType.id, mayReadCosts: has('cost.read') })),
        currency: organization.currency,
        mayReadCosts: has('cost.read'),
        mayManageCosts: has('cost.manage'),
        mayManagePrices: has('price.manage'),
      }
    : undefined;
  const deletable = selectedType?.archivedAt ? (await db.rpc('work_type_deletable', { p_type_id: selectedType.id })).data === true : false;
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <AppPage>
      {/* The configuration layout's section navigation and the workspace bar already name this place. */}
      <PageHeader
        title={<span className="sr-only">Work type settings</span>}
        breadcrumbLabel={fieldsOpen ? 'Fields' : selectedType?.name ?? 'Work types'}
        crumbs={[...workspaceConfigCrumbs(organizationId, 'work-configuration', gate), ...(selectedType ? [{ label: 'Work types', href: listHref }] : [])]}
        className="mb-0"
        actions={!selectedType?.archivedAt && (returnTo === 'create' || statuses.length > 0) && organization.capabilities.includes('work_item.create') ? <NewWorkAction organizationId={organizationId} typeId={selectedType?.id} returnTo={quote === '1' ? 'quote' : undefined} setupStep={step ?? undefined} /> : undefined}
      />
      <WorkConfiguration
        variant="page"
        typeRequested={typeof requestedType === 'string' && types.some((type) => type.id === requestedType)}
        listHref={listHref}
        createOpen={requestedNew === '1'}
        initialTab={typeof requestedTab === 'string' ? requestedTab : undefined}
        organizationId={organizationId}
        role={organization.role}
        mayConfigure={mayConfigure}
        deletable={deletable}
        pricing={pricing}
        fieldsOpen={fieldsOpen}
        fieldsHref={`/organizations/${organizationId}/work/configuration?${new URLSearchParams([...context, ['tab', 'fields']])}`}
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
        intakeForms={intakeForms}
        typeHref={(typeId) => `/organizations/${organizationId}/work/configuration?${context.size ? `${context}&` : ''}type=${typeId}`}
      />
    </AppPage>
  );
}
