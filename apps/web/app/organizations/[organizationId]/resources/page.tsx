import { CustomFieldValues } from '@/components/custom-field-values';
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
      <p className="text-sm opacity-70">
        People, vehicles and equipment that work is scheduled against.
      </p>

      {resources.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No resources yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {resources.map((resource) => (
            <li key={resource.id} className="py-3">
              <div className="font-medium">{resource.name}</div>
              <CustomFieldValues definitions={definitions} custom={resource.custom} />
            </li>
          ))}
        </ul>
      )}

      {/*
        Hiding the form is a courtesy, not the guard. `resources_insert` requires
        resource.create in the database, so a caller who reaches the action anyway is
        refused there (constraints.md: hiding a UI element is not authorization).
      */}
      {mayAdd ? (
        <CreateResourceForm organizationId={organizationId} definitions={definitions} />
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot add resources here.
        </p>
      )}
    </>
  );
}
