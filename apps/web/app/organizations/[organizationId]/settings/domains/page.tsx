import { Hint } from '@/components/controls/inputs';
import { ConnectDomainDialog } from '@/features/domains/connect-domain-dialog';
import { DomainsList } from '@/features/domains/domains-list';
import { PublicBookingAddressForm } from '@/features/public-profile/public-booking-address-form';
import { CardSection } from '@/components/surfaces/card';
import { listBookableTypes } from '@/lib/domain/booking/booking';
import { ManagedAddress } from '@/features/domains/managed-address';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { getManagedHostname, listDomains, platformPublicDomain } from '@/lib/domain/domains/domains';
import { listConnectedDnsZones } from '@/lib/domain/domains/dns-zones';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function DomainsSettingsPage({ params }: PageProps<'/organizations/[organizationId]/settings/domains'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');

  const [address, domains, zone, cloudflareZones, bookableTypes] = await Promise.all([
    getManagedHostname(db, { slug: organization.slug }),
    mayManage ? listDomains(db, organizationId) : Promise.resolve([]),
    platformPublicDomain(db),
    mayManage ? listConnectedDnsZones(db, organizationId) : Promise.resolve([]),
    mayManage ? listBookableTypes(db, { organizationId }) : Promise.resolve([]),
  ]);

  return (
    <SettingsPageFrame>
      <SettingsPageHeader
        title="Domains"
        actions={
          mayManage ? (
            <ConnectDomainDialog organizationId={organizationId} platformZone={zone} />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
      {mayManage ? (
        <CardSection id="booking-address" title="Public booking address" className="scroll-mt-6">
          <PublicBookingAddressForm
            organizationId={organizationId}
            slug={organization.slug}
            hasBookableType={bookableTypes.length > 0}
          />
        </CardSection>
      ) : null}
      {mayManage ? (
        <>
          <ManagedAddress address={address} generalHref={`/organizations/${organizationId}/settings/general`} />
          <DomainsList organizationId={organizationId} domains={domains} mayManage={mayManage} cloudflareZones={cloudflareZones} />
        </>
      ) : (
        <>
          <ManagedAddress address={address} generalHref={`/organizations/${organizationId}/settings/general`} />
          <Hint>Your role, {organization.role}, cannot connect or manage domains for this business.</Hint>
        </>
      )}
      </div>
    </SettingsPageFrame>
  );
}
