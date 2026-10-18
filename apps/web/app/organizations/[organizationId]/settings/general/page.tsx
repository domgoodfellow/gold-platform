import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { requireOrganization } from '@/lib/route/organization';
import { OrganizationSettingsForm } from '@/features/tenancy/organization-settings-form';
import { getOrganizationIdentity, missingIdentity } from '@/lib/domain/tenancy/identity';
import { BusinessProfileSettings } from '@/features/tenancy/business-profile-settings';

export const dynamic = 'force-dynamic';

/** The business profile: identity, primary address, contact, and the regional defaults they imply. */
export default async function GeneralSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/general'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const identity = await getOrganizationIdentity(db, organizationId);
  const missing = missingIdentity(identity);

  return (
    <SettingsPageFrame>
      <SettingsPageHeader title="General" />

      {mayManage ? (
        <>
          {missing.length > 0 ? (
            <p role="status" className="mb-8 rounded-lg border border-border bg-hover/40 p-4 text-sm">
              To complete your business profile, add {missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}.
            </p>
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
      {mayManage ? <BusinessProfileSettings organizationId={organizationId}/> : null}
    </SettingsPageFrame>
  );
}
