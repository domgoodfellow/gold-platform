import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { PageChromeRegistrar } from '@/components/containers/workspace-page-chrome';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { ResourceConfiguration } from '@/features/resources/configuration/resource-configuration';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResources } from '@/lib/domain/resources/resources';
import { requireOrganization } from '@/lib/route/organization';
import { CreateResourceSheetProvider, CreateResourceTrigger } from './create-resource-sheet';

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
    <AppPage width="wide">
      <CreateResourceSheetProvider organizationId={organizationId} definitions={definitions}>
        {/*
          Hiding the trigger is a courtesy, not the guard. `resources_insert` requires
          resource.create in the database, so a caller who reaches the action anyway is
          refused there (constraints.md: hiding a UI element is not authorization).
        */}
        <PageChromeRegistrar title="Resources" actions={mayAdd ? <CreateResourceTrigger /> : null} />
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
        <Hint>People, vehicles and equipment that work is scheduled against.</Hint>

        <div className="mt-6">
          <DataTable
            rows={resources}
            rowKey={(resource) => resource.id}
            empty="No resources yet."
            emptyAction={mayAdd ? <CreateResourceTrigger /> : undefined}
            columns={[
              {
                key: 'name',
                header: 'Name',
                emphasis: 'primary',
                cell: (r) => (
                  <Link
                    href={`/organizations/${organizationId}/resources/${r.id}`}
                    className="underline underline-offset-4"
                  >
                    {r.name}
                  </Link>
                ),
              },
              ...(definitions.length > 0
                ? [
                    {
                      key: 'custom',
                      header: 'Details',
                      cell: (r: (typeof resources)[number]) => (
                        <CustomFieldValues definitions={definitions} custom={r.custom} />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </CreateResourceSheetProvider>
    </AppPage>
  );
}
