import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/containers/page-header';
import { areaLabel } from '@/lib/navigation';
import { Section, SectionHeading } from '@/components/containers/section';
import { ProfileForm } from '@/features/public-profile/profile-form';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { listBookableTypes } from '@/lib/domain/booking/booking';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { requireOrganization } from '@/lib/route/organization';
import { updateProfileAction } from '../actions';
import { BrandForm, LogoForm } from '@/features/branding/brand-forms';

export const dynamic = 'force-dynamic';

/**
 * What a stranger sees before they book, and what this business looks like on every screen —
 * moved off the Settings root page (product architecture correction) so Business groups its own
 * durable identity settings together. `MODULES`'s `booking.configuredAt` now names this route
 * directly (`segment: 'settings', path: 'branding'`).
 */
export default async function BrandingSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/branding'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [profile, brand, bookableTypes] = await Promise.all([
    publicProfile(db, { organizationId, fallbackName: organization.name }),
    getBrand(db, { organizationId }),
    listBookableTypes(db, { organizationId }),
  ]);

  const mayManage = organization.capabilities.includes('organization.manage');

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Branding"
        crumbs={[{ label: areaLabel('settings'), href: `/organizations/${organizationId}/settings` }]}
        description="What customers see before they book, and how this business looks."
      />

      <Section id="public-page" className="scroll-mt-6">
        <SectionHeading>Public page</SectionHeading>
        <Hint className="mt-1">
          What customers see before they book. Everything here is this business&rsquo;s own
          words — the platform writes none of it, and a page left empty shows the business name
          and nothing else.
        </Hint>

        {mayManage ? (
          <ProfileForm
            organizationId={organizationId}
            profile={profile}
            slug={organization.slug}
            hasBookableType={bookableTypes.length > 0}
            action={updateProfileAction}
          />
        ) : (
          <Hint className="mt-4">
            Your role, {organization.role}, cannot change what this business says about itself.
          </Hint>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>How this business looks</SectionHeading>
        <Hint className="mt-1">
          Your colour, your lettering and your logo, on these screens and on any page your
          customers see. The page itself stays readable whatever you choose — a colour is used
          for buttons and links, and darkened automatically where it would be hard to read.
        </Hint>

        {mayManage ? (
          <>
            <BrandForm organizationId={organizationId} brand={brand} />
            <LogoForm
              organizationId={organizationId}
              logoUrl={brand.logoPath ? logoUrl(db, brand.logoPath) : null}
            />
          </>
        ) : (
          <Hint className="mt-4">
            Your role, {organization.role}, cannot change how this business looks.
          </Hint>
        )}
      </Section>
    </SettingsPageFrame>
  );
}
