import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Hint } from '@/components/controls/inputs';
import { TemplatesBrowser } from '@/features/studio/templates/templates-browser';
import { listFormTemplates } from '@/lib/domain/forms/forms';
import { listPageTemplates, listSectionPatterns, listSiteTemplates, siteEditorState } from '@/lib/domain/public-site/public-site';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { portalEditorState } from '@/lib/domain/portal/definitions';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { publicProfile } from '@/lib/domain/tenancy/profile';

export const dynamic = 'force-dynamic';

/**
 * Studio → Templates: starting points, by what they make. A website, a page, a section and a form
 * each keep their own typed templates rather than sharing one catalogue of payloads; this page
 * lists the kinds there are and filters by them. Using a template always makes something the
 * business owns outright.
 */
export default async function StudioTemplatesPage({ params }: PageProps<'/organizations/[organizationId]/studio/templates'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const portal = mayManage ? await portalEditorState(db, organizationId) : null;
  const [formTemplates, siteTemplates, pageTemplates, sectionPatterns, site] = mayManage
    ? await Promise.all([listFormTemplates(db), listSiteTemplates(db), listPageTemplates(db), listSectionPatterns(db), siteEditorState(db, organizationId)])
    : [[], [], [], [], null];
  // Templates are previewed as this business's own website would draw them.
  const [brand, profile] = await Promise.all([getBrand(db, { organizationId }), publicProfile(db, { organizationId, fallbackName: organization.name })]);
  const frame = {
    profile,
    brand: { accent: brand.accent, headingFont: brand.headingFont, bodyFont: brand.bodyFont, logoPath: brand.logoPath },
    logoSrc: brand.logoPath ? logoUrl(db, brand.logoPath) : null,
  };

  return (
    <AppPage>
      <CollectionHeader title={areaLabel('studio-templates')} crumbs={workspaceAncestry(organizationId, 'studio-templates')} />
      {!mayManage ? (
        <Hint>{`Your role, ${organization.role}, cannot create from templates.`}</Hint>
      ) : (
        <TemplatesBrowser
          organizationId={organizationId}
          hasWebsite={site !== null}
          hasPortal={!!portal?.definition}
          frame={frame}
          siteTemplates={siteTemplates}
          pageTemplates={pageTemplates}
          sectionPatterns={sectionPatterns}
          formTemplates={formTemplates}
        />
      )}
    </AppPage>
  );
}
