import { AppPage } from '@/components/layout/app-page';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ResourceConfiguration } from '@/features/resources/configuration/resource-configuration';
import { ResourceTable } from '@/features/resources/resource-table';
import { CreateResourceSheetProvider, CreateResourceTrigger } from '@/features/resources/create-resource-sheet';
import { availableMembers } from '@/features/resources/member-options';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResources } from '@/lib/domain/resources/resources';
import { listMembers } from '@/lib/domain/tenancy/members';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function ResourcesPage({
  params,
}: PageProps<'/organizations/[organizationId]/resources'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [resources, definitions, members] = await Promise.all([
    listResources(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'resource' }),
    listMembers(db, { organizationId }),
  ]);

  const mayAdd = organization.capabilities.includes('resource.create');
  const mayConfigure = organization.capabilities.includes('field.manage');
  const memberOptions = availableMembers(members, resources);

  return (
    <AppPage>
      <CreateResourceSheetProvider
        organizationId={organizationId}
        definitions={definitions}
        availableMembers={memberOptions}
      >
        {/*
          Hiding the trigger is a courtesy, not the guard. `resources_insert` requires
          resource.create in the database, so a caller who reaches the action anyway is
          refused there (constraints.md: hiding a UI element is not authorization).
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
            />
          </ConfigureRegistrar>
        ) : null}
        <div>
          <ResourceTable organizationId={organizationId} resources={resources} definitions={definitions} />
        </div>
      </CreateResourceSheetProvider>
    </AppPage>
  );
}
