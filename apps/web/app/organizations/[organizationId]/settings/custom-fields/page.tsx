import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { areaLabel } from '@/lib/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { requireOrganization } from '@/lib/route/organization';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import { FieldEntityNav } from '@/features/custom-fields/configuration/field-entity-nav';
import { resolveFieldEntity } from './field-entities';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';

export const dynamic = 'force-dynamic';

/** "What does this business record beyond the platform's own fields?" — one field registry, read and written per entity. */
export default async function FieldsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/custom-fields'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const rawEntity = Array.isArray(query.entity) ? query.entity[0] : query.entity;
  const entityType = resolveFieldEntity(rawEntity);
  const { db, organization } = await requireOrganization(organizationId);
  const definitions = await listFieldDefinitions(db, { organizationId, entityType });
  const mayManage = organization.capabilities.includes('field.manage');

  return (
    <SettingsPageFrame>
      <PageHeader
        title={areaLabel('fields')}
        crumbs={[
          ...workspaceConfigCrumbs(organizationId, 'custom-fields'),
        ]}
      />
      <FieldEntityNav organizationId={organizationId} entityType={entityType} />
      <EntityFieldsConfiguration
        organizationId={organizationId}
        entityType={entityType}
        role={organization.role}
        mayConfigure={mayManage}
        definitions={definitions}
      />
    </SettingsPageFrame>
  );
}
