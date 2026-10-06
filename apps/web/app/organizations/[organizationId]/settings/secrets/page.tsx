import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { SecretsList } from '@/features/secrets/secrets-list';
import { SecretSheet } from '@/features/secrets/secret-sheet';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listSecretReferences } from '@/lib/domain/secrets/secret-references';
import { requireOrganization } from '@/lib/route/organization';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

export const dynamic = 'force-dynamic';

export default async function SecretsSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/secrets'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('secret.manage');
  const references = mayManage ? await listSecretReferences(db, { organizationId }) : [];

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Secrets & credentials"
        crumbs={[{ label: 'Settings', href: settingsLandingHref(organizationId) }, { label: 'Connections', href: settingsScopeHref('connections', organizationId) }]}
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
