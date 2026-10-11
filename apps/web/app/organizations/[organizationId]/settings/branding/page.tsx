import { BrandEditor } from '@/features/branding/brand-editor';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-frame';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * How this business looks: logo, one brand colour, and lettering. What it says about itself
 * lives in Public profile and where it is reached in Domains, each under its own owner.
 */
export default async function BrandingSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/branding'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const brand = await getBrand(db, { organizationId });
  const mayManage = organization.capabilities.includes('organization.manage');

  return (
    <SettingsPageFrame>
      <SettingsPageHeader
        title="Branding"
      />
      <BrandEditor
        organizationId={organizationId}
        brand={brand}
        logoUrl={brand.logoPath ? logoUrl(db, brand.logoPath) : null}
        name={organization.name}
        readOnly={!mayManage}
      />
    </SettingsPageFrame>
  );
}
