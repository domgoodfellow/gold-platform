import { AppPage } from '@/components/containers/app-page';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { PageHeader } from '@/components/containers/page-header';
import { ResourceConfiguration } from '@/features/resources/configuration/resource-configuration';
import { ResourceTable } from '@/features/resources/resource-table';
import { CreateResourceSheetProvider, CreateResourceTrigger } from '@/features/resources/create-resource-sheet';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResources } from '@/lib/domain/resources/resources';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function ResourcesPage({
  params,
}: PageProps<'/organizations/[organizationId]/resources'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [resources, definitions] = await Promise.all([
    listResources(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'resource' }),
  ]);

  const mayAdd = organization.capabilities.includes('resource.create');
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <AppPage>
      <CreateResourceSheetProvider organizationId={organizationId} definitions={definitions}>
        {/*
          Hiding the trigger is a courtesy, not the guard. `resources_insert` requires
          resource.create in the database, so a caller who reaches the action anyway is
          refused there (constraints.md: hiding a UI element is not authorization).
        */}
        <PageHeader
          title={areaLabel('resources')}
          description="People, vehicles and equipment that work is scheduled against."
          actions={mayAdd ? <CreateResourceTrigger /> : null}
          configure={mayConfigure}
        />
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Resources configuration"
            settingsHref={`/organizations/${organizationId}/fields`}
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
