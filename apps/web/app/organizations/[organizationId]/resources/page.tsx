import Link from 'next/link';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { RESOURCE_CLASS_LABELS, isResourceClass } from '@/lib/domain/resources/resource-class';
import { listScheduleDays } from '@/lib/domain/scheduling/availability';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { parseScheduleDate } from '@/features/scheduling/calendar/schedule-url';
import { AppPage } from '@/components/layout/app-page';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ResourceConfiguration } from '@/features/resources/configuration/resource-configuration';
import { ResourceTable } from '@/features/resources/resource-table';
import { CreateResourceSheetProvider, CreateResourceTrigger } from '@/features/resources/create-resource-sheet';
import { availableMembers } from '@/features/resources/member-options';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResourceCapabilities } from '@/lib/domain/resources/resource-capabilities';
import { listResources } from '@/lib/domain/resources/resources';
import { listMembers } from '@/lib/domain/tenancy/members';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { SelectField } from '@/components/controls/select-field';

export const dynamic = 'force-dynamic';

export default async function ResourcesPage({
  params, searchParams,
}: PageProps<'/organizations/[organizationId]/resources'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const query = await searchParams;
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(query.page)) || 1));
  const rawClass = typeof query.class === 'string' ? query.class : '';
  const resourceClass = isResourceClass(rawClass) ? rawClass : undefined;
  const date = parseScheduleDate(query.on, todayInZone(organization.timezone));
  const [resources, definitions, members, vocabulary, days, allResources] = await Promise.all([
    listResources(db, { organizationId, limit: 20, offset: (page - 1) * 20, resourceClass, capabilityId: typeof query.capability === 'string' ? query.capability : undefined }),
    listFieldDefinitions(db, { organizationId, entityType: 'resource' }),
    listMembers(db, { organizationId }),
    listResourceCapabilities(db, { organizationId, includeArchived: true }),
    listScheduleDays(db, { organizationId, dates: [date], timeZone: organization.timezone }),
    listResources(db, { organizationId, limit: 1000 }),
  ]);

  const mayAdd = organization.capabilities.includes('resource.create');
  const mayConfigure = organization.capabilities.includes('field.manage');
  const memberOptions = availableMembers(members, allResources);

  return (
    <AppPage>
      <CreateResourceSheetProvider
        organizationId={organizationId}
        definitions={definitions}
        availableMembers={memberOptions}
        capabilities={vocabulary.filter((capability) => !capability.archived)}
        mayAddCapability={mayConfigure}
      >
        {/*
          Hiding the trigger is a courtesy, not the guard. `resources_insert` requires
          resource.create in the database, so a caller who reaches the action anyway is
          refused there (`docs/security.md`: hiding a UI element is not authorization).
        */}
        <CollectionHeader
          title={areaLabel('resources')}
          crumbs={workspaceAncestry(organizationId, 'resources')}
          actions={mayAdd ? <CreateResourceTrigger /> : null}
          configure={mayConfigure}
        />
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Resources configuration"
            settingsHref={`/organizations/${organizationId}/settings/custom-fields`}
          >
            <ResourceConfiguration
              organizationId={organizationId}
              role={organization.role}
              mayConfigure={mayConfigure}
              definitions={definitions}
              capabilities={vocabulary}
            />
          </ConfigureRegistrar>
        ) : null}
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <label className="text-xs text-muted">Resource class<SelectField name="class" defaultValue={resourceClass ?? ''} options={[{ value: '', label: 'All classes' }, ...Object.entries(RESOURCE_CLASS_LABELS).map(([id, label]) => ({ value: id, label: label }))]} /></label>
          <label className="text-xs text-muted">Capability<SelectField name="capability" defaultValue={typeof query.capability === 'string' ? query.capability : ''} options={[{ value: '', label: 'All capabilities' }, ...vocabulary.map((c) => ({ value: c.id, label: c.name }))]} /></label>
          <label className="text-xs text-muted">Availability date<TextInput type="date" name="on" defaultValue={date}/></label><Button size="small">Apply filters</Button>
        </form>
        <div>
          <p className="mb-2 text-xs text-muted">{resources.total} resources ? Page {page} ? Times in {organization.timezone}</p>
          <ResourceTable organizationId={organizationId} resources={resources} definitions={definitions} schedule={days[0].resources} timezone={organization.timezone} />
          <nav aria-label="Resource pagination" className="mt-3 flex gap-4 text-xs">{[page > 1 ? page - 1 : null, page * 20 < resources.total ? page + 1 : null].map((target, i) => target ? <Link key={i} href={`?class=${resourceClass ?? ''}&capability=${typeof query.capability === 'string' ? query.capability : ''}&on=${date}&page=${target}`}>{i === 0 ? 'Previous' : 'Next'}</Link> : null)}</nav>
        </div>
      </CreateResourceSheetProvider>
    </AppPage>
  );
}
