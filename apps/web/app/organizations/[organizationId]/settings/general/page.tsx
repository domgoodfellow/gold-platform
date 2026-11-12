import Link from 'next/link';
import { Alert } from '@gold/ui/components/alert';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { LegacyAnchorRedirect } from '@/features/settings/legacy-anchor-redirect';
import { requireOrganization } from '@/lib/route/organization';
import { legacyPaymentSettingsHref } from '@/lib/route/settings';
import { configurationTargetOffered } from '@/lib/route/workspace-configuration';
import { OrganizationSettingsForm } from '@/features/tenancy/organization-settings-form';
import { getOrganizationIdentity, missingIdentity } from '@/lib/domain/tenancy/identity';

export const dynamic = 'force-dynamic';

/**
 * The business profile: identity, primary address, contact, and regional settings. Customer payments
 * and Words & navigation are their own Settings pages; old `#getting-paid` links forward there.
 */
export default async function GeneralSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/general'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const identity = await getOrganizationIdentity(db, organizationId);
  const missing = missingIdentity(identity);
  const paymentsOffered = await configurationTargetOffered(organizationId, 'payments');

  return (
    <SettingsPageFrame>
      {paymentsOffered ? <LegacyAnchorRedirect anchors={{ 'getting-paid': `${legacyPaymentSettingsHref(organizationId, true)}#getting-paid` }} /> : null}
      <SettingsPageHeader title="General" />

      {mayManage ? (
        <>
          {missing.length > 0 ? (
            <Alert role="status" className="mb-6 block">
              To complete your business profile, add {missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}.
            </Alert>
          ) : null}
          <OrganizationSettingsForm
            organizationId={organizationId}
            name={organization.name}
            timezone={organization.timezone}
            currency={organization.currency}
            identity={identity}
          />
        </>
      ) : (
        <Hint>
          Your role, {organization.role}, cannot change the business profile. Ask an administrator, or see{' '}
          <Link href={`/organizations/${organizationId}/settings/access`} className="text-accent-text hover:underline">who has access</Link>.
        </Hint>
      )}
    </SettingsPageFrame>
  );
}
