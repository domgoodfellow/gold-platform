import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Hint } from '@/components/controls/inputs';
import { TemplatesBrowser } from '@/features/studio/templates/templates-browser';
import { listFormTemplates } from '@/lib/domain/forms/forms';
import { listPageTemplates, listSectionPatterns, listSiteTemplates, siteEditorState } from '@/lib/domain/public-site/public-site';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

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
  const [formTemplates, siteTemplates, pageTemplates, sectionPatterns, site] = mayManage
    ? await Promise.all([listFormTemplates(db), listSiteTemplates(db), listPageTemplates(db), listSectionPatterns(db), siteEditorState(db, organizationId)])
    : [[], [], [], [], null];

  return (
    <AppPage>
      <CollectionHeader title={areaLabel('studio-templates')} crumbs={workspaceAncestry(organizationId, 'studio-templates')} />
      {!mayManage ? (
        <Hint>{`Your role, ${organization.role}, cannot create from templates.`}</Hint>
      ) : (
        <TemplatesBrowser
          organizationId={organizationId}
          hasWebsite={site !== null}
          siteTemplates={siteTemplates}
          pageTemplates={pageTemplates}
          sectionPatterns={sectionPatterns}
          formTemplates={formTemplates}
        />
      )}
    </AppPage>
  );
}
