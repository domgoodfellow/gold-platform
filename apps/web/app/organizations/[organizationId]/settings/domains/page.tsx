import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { areaLabel } from '@/lib/navigation';
import { ConnectDomainDialog } from '@/features/domains/connect-domain-dialog';
import { DomainsList } from '@/features/domains/domains-list';
import { ManagedAddress } from '@/features/domains/managed-address';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { SettingsScopeNav } from '@/features/settings/settings-scope-nav';
import { getManagedHostname, listDomains, platformPublicDomain } from '@/lib/domain/domains/domains';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function DomainsSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/domains'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');

  const [address, domains, zone] = await Promise.all([
    getManagedHostname(db, { slug: organization.slug }),
    mayManage ? listDomains(db, organizationId) : Promise.resolve([]),
    platformPublicDomain(db),
  ]);

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Domains"
        crumbs={[{ label: areaLabel('settings'), href: `/organizations/${organizationId}/settings` }]}
        description="Where customers reach this business: its GildOps address, and any domain it owns and has connected."
        actions={mayManage ? <ConnectDomainDialog organizationId={organizationId} platformZone={zone} /> : undefined}
      />
      <SettingsScopeNav organizationId={organizationId} organizationName={organization.name} active="organization" />
      {mayManage ? (
        <>
          <ManagedAddress address={address} generalHref={`/organizations/${organizationId}/settings/general`} />
          <DomainsList organizationId={organizationId} domains={domains} mayManage={mayManage} />
        </>
      ) : (
        <>
          <ManagedAddress address={address} generalHref={`/organizations/${organizationId}/settings/general`} />
          <Hint className="mt-5">Your role, {organization.role}, cannot connect or manage domains for this business.</Hint>
        </>
      )}
    </SettingsPageFrame>
  );
}
