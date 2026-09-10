import { Disclosure } from '@/components/containers/card';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listResources } from '@/lib/domain/resources/resources';
import { requireOrganization } from '@/lib/route/organization';
import { CreateResourceForm } from './create-resource-form';

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

  return (
    <>
      <Hint>
        People, vehicles and equipment that work is scheduled against.
      </Hint>

      {/*
        Hiding the form is a courtesy, not the guard. `resources_insert` requires
        resource.create in the database, so a caller who reaches the action anyway is
        refused there (constraints.md: hiding a UI element is not authorization).
      */}
      {mayAdd ? (
        <Disclosure summary="Add a resource" defaultOpen={resources.length === 0} className="mt-6">
          <CreateResourceForm organizationId={organizationId} definitions={definitions} />
        </Disclosure>
      ) : (
        <Hint className="mt-6">
          Your role, {organization.role}, cannot add resources here.
        </Hint>
      )}

      <div className="mt-6">
        <DataTable
          rows={resources}
          rowKey={(resource) => resource.id}
          empty="No resources yet."
          columns={[
            { key: 'name', header: 'Name', emphasis: 'primary', cell: (r) => r.name },
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
    </>
  );
}
