import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { PageHeader } from '@/components/headers/page-header';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
export default async function CustomerFields({ params }: PageProps<'/organizations/[organizationId]/crm/configuration/fields'>) {
 const { organizationId } = await params;
 const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'customer-fields');
 const definitions = await listFieldDefinitions(db, { organizationId, entityType: 'customer' });
 return <SettingsPageFrame><PageHeader title="Customer fields" crumbs={workspaceConfigCrumbs(organizationId, 'customer-fields', gate)} /><EntityFieldsConfiguration organizationId={organizationId} entityType="customer" role={organization.role} mayConfigure definitions={definitions} /></SettingsPageFrame>;
}
