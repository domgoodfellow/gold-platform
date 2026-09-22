import { areaLabel } from '@/lib/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { requireOrganization } from '@/lib/route/organization';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import { FieldEntityNav } from '@/features/custom-fields/configuration/field-entity-nav';
import { resolveFieldEntity } from './field-entities';

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
      <PageHeader title={areaLabel('fields')} description="What this business records beyond the platform&rsquo;s own fields." />
      <FieldEntityNav organizationId={organizationId} entityType={entityType} />
      <EntityFieldsConfiguration
        organizationId={organizationId}
        entityType={entityType}
        role={organization.role}
        mayConfigure={mayManage}
        definitions={definitions}
      />
    </>
  );
}
