import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { WebsiteWorkbench } from '@/features/studio/website/website-workbench';
import { listForms } from '@/lib/domain/forms/forms';
import { listPageTemplates, listSectionPatterns, listSiteTemplates, siteEditorState } from '@/lib/domain/public-site/public-site';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Studio's Website workbench — where a business creates, edits, reviews and publishes its own
 * website. This is an operating surface, not a Settings form: the page *is* the workbench (a
 * three-pane Structure/Canvas/Inspector layout with a state-aware toolbar), never a card wrapping
 * one more link. A business with no website sees how to create one; creating needs no platform
 * step and no hostname.
 *
 * The domain underneath is the one public-site engine (`lib/domain/public-site/public-site.ts`) —
 * this route, `studio/website/actions.ts` and the private `/preview` route are all callers of it,
 * never a second implementation.
 */
export default async function StudioWebsitePage({ params }: PageProps<'/organizations/[organizationId]/studio/website'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const [state, forms, siteTemplates, pageTemplates, sectionPatterns] = mayManage
    ? await Promise.all([
        siteEditorState(db, organizationId), listForms(db, organizationId),
        listSiteTemplates(db), listPageTemplates(db), listSectionPatterns(db),
      ])
    : [null, [], [], [], []];

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('studio-website')}
        crumbs={workspaceAncestry(organizationId, 'studio-website')}
      />
      {mayManage ? (
        <WebsiteWorkbench
          organizationId={organizationId}
          hasWebsite={state !== null}
          working={state?.working ?? null}
          published={state?.published ?? null}
          history={state?.history ?? []}
          forms={forms.filter((form) => !form.archived).map((form) => ({ id: form.id, name: form.name, published: form.publishedRevisionNumber !== null }))}
          siteTemplates={siteTemplates}
          pageTemplates={pageTemplates}
          sectionPatterns={sectionPatterns}
        />
      ) : (
        <Hint className="mt-5">{`Your role, ${organization.role}, cannot edit or preview this website.`}</Hint>
      )}
    </AppPage>
  );
}
