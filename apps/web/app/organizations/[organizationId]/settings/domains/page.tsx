import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { ConnectDomainDialog } from '@/features/domains/connect-domain-dialog';
import { DomainsList } from '@/features/domains/domains-list';
import { PublicBookingAddressForm } from '@/features/public-profile/public-booking-address-form';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { listBookableTypes } from '@/lib/domain/booking/booking';
import { ManagedAddress } from '@/features/domains/managed-address';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { getManagedHostname, listDomains, platformPublicDomain } from '@/lib/domain/domains/domains';
import { listConnectedDnsZones } from '@/lib/domain/domains/dns-zones';
import { requireOrganization } from '@/lib/route/organization';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

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
      <PageHeader
        title="Domains"
        crumbs={[
          { label: 'Settings', href: settingsLandingHref(organizationId) },
          { label: 'Organization', href: settingsScopeHref('organization', organizationId) },
        ]}
        actions={
          mayManage ? (
            <ConnectDomainDialog organizationId={organizationId} platformZone={zone} />
          ) : undefined
        }
      />
      {mayManage ? (
        <Section id="booking-address" className="mb-8 scroll-mt-6">
          <SectionHeading>Public booking address</SectionHeading>
          <PublicBookingAddressForm
            organizationId={organizationId}
            slug={organization.slug}
            hasBookableType={bookableTypes.length > 0}
          />
        </Section>
      ) : null}
      {mayManage ? (
        <>
          <ManagedAddress address={address} generalHref={`/organizations/${organizationId}/settings/general`} />
          <DomainsList organizationId={organizationId} domains={domains} mayManage={mayManage} cloudflareZones={cloudflareZones} />
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
