import { Hint } from '@/components/controls/inputs';
import { requireOrganization } from '@/lib/route/organization';
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  listFieldDefinitions,
} from '@/lib/domain/fields/field-definitions';
import { EntityFieldsConfiguration } from '@/features/fields/entity-fields-configuration';
import { resolveFieldEntity } from './field-entities';
import { FieldEntityTabs } from './field-entity-tabs';

export const dynamic = 'force-dynamic';

/** "What does this business record beyond the platform's own fields?" — one field registry, read and written per entity. */
export default async function FieldsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/fields'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const rawEntity = Array.isArray(query.entity) ? query.entity[0] : query.entity;
  const entityType = resolveFieldEntity(rawEntity);
  const { db, organization } = await requireOrganization(organizationId);
  const definitions = await listFieldDefinitions(db, { organizationId, entityType });
  const mayManage = organization.capabilities.includes('field.manage');

  return (
    <>
      <Hint>What this business records beyond the platform&rsquo;s own fields.</Hint>

      <div className="mt-6">
        <FieldEntityTabs entityType={entityType} />
      </div>
      <section className="mt-6">
        <h2 className="text-base font-semibold">{CUSTOM_FIELD_ENTITY_LABELS[entityType]}</h2>
        <Hint className="mt-1">Extra information recorded on {CUSTOM_FIELD_ENTITY_LABELS[entityType].toLowerCase()}.</Hint>
        <div className="mt-4">
          <EntityFieldsConfiguration
            organizationId={organizationId}
            entityType={entityType}
            role={organization.role}
            mayConfigure={mayManage}
            definitions={definitions}
          />
        </div>
      </section>
    </>
  );
}
