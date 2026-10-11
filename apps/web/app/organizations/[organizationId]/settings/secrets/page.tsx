import { Hint } from '@/components/controls/inputs';
import { SecretsList } from '@/features/secrets/secrets-list';
import { SecretSheet } from '@/features/secrets/secret-sheet';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { listSecretReferences } from '@/lib/domain/secrets/secret-references';
import { requireOrganization } from '@/lib/route/organization';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';

export const dynamic = 'force-dynamic';

export default async function SecretsSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/secrets'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('secret.manage');
  const references = mayManage ? await listSecretReferences(db, { organizationId }) : [];

  return (
    <SettingsPageFrame width="fluid">
      <SettingsPageHeader
        title="Secrets & credentials"
        actions={mayManage ? <SecretSheet mode="create" organizationId={organizationId} /> : undefined}
      />
      <IntegrationsNav organizationId={organizationId} current="secrets" />
      {mayManage ? (
        <SecretsList organizationId={organizationId} references={references} />
      ) : (
        <Hint className="mt-5">Your role, {organization.role}, cannot see or manage this business’s private credentials.</Hint>
      )}
    </SettingsPageFrame>
  );
}
