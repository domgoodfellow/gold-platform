import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { Hint } from '@/components/controls/inputs';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { WebsiteWorkbench } from '@/features/studio/website/website-workbench';
import { homepageEditorState } from '@/lib/domain/public-site/public-site';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Studio's Website workbench — the canonical place to edit, review and publish the GildOps
 * homepage. This is an operating surface, not a Settings form: the page *is* the workbench (a
 * three-pane Structure/Canvas/Inspector layout with a state-aware toolbar), never a card wrapping
 * one more link.
 *
 * The domain underneath is the one public-site engine (`lib/domain/public-site/public-site.ts`) —
 * this route, `studio/website/actions.ts` and the private `/preview` route are all callers of it,
 * never a second implementation.
 */
export default async function StudioWebsitePage({ params }: PageProps<'/organizations/[organizationId]/studio/website'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const state = mayManage ? await homepageEditorState(db, organizationId) : null;

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('studio-website')}
        crumbs={workspaceAncestry(organizationId, 'studio-website')}
        description="Edit a private draft, review the exact rendered page, then publish deliberately."
      />
      {mayManage && state ? (
        <WebsiteWorkbench
          // Local editing state (`sections`, `seoTitle`, dirty snapshot) is only meant to
          // initialize once per revision. Keying on the revision id forces a fresh mount when a
          // draft appears, is replaced, or moves to a different id — never a stale `useState`
          // default left over from the "no working revision yet" render.
          key={state.working?.id ?? 'none'}
          organizationId={organizationId}
          working={state.working}
          published={state.published}
          history={state.history}
        />
      ) : (
        <Hint className="mt-5">
          {mayManage ? 'No website is configured for this organization on the platform domain.' : `Your role, ${organization.role}, cannot edit or preview this website.`}
        </Hint>
      )}
    </AppPage>
  );
}
