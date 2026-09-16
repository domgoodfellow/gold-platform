import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import { requireOrganization } from '@/lib/route/organization';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  listFieldDefinitions,
  type CustomFieldEntity,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { EntityFieldsConfiguration } from '@/features/fields/entity-fields-configuration';

export const dynamic = 'force-dynamic';

/** "What does this business record beyond the platform's own fields?" — one field registry, read and written per entity. */
export default async function FieldsPage({
  params,
}: PageProps<'/organizations/[organizationId]/fields'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const byEntity = await Promise.all(
    CUSTOM_FIELD_ENTITIES.map(async (entityType): Promise<[CustomFieldEntity, FieldDefinition[]]> => [
      entityType,
      await listFieldDefinitions(db, { organizationId, entityType }),
    ]),
  );
  const mayManage = organization.capabilities.includes('field.manage');

  return (
    <>
      <Hint>What this business records beyond the platform&rsquo;s own fields.</Hint>

      {byEntity.map(([entityType, definitions]) => (
        <section key={entityType} className="mt-6 first:mt-0">
          <SectionHeading>{CUSTOM_FIELD_ENTITY_LABELS[entityType]}</SectionHeading>
          <div className="mt-2">
            <EntityFieldsConfiguration
              organizationId={organizationId}
              entityType={entityType}
              role={organization.role}
              mayConfigure={mayManage}
              definitions={definitions}
            />
          </div>
        </section>
      ))}
    </>
  );
}
