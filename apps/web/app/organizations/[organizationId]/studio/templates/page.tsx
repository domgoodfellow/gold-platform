import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Hint } from '@/components/controls/inputs';
import { EmptyState } from '@/components/surfaces/section';
import { TemplateList } from '@/features/studio/forms/template-list';
import { listFormTemplates } from '@/lib/domain/forms/forms';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Studio → Templates: starting points, by what they make. Form templates are the first (and so far
 * only) kind; each kind of artifact keeps its own typed templates rather than sharing one catalogue
 * of payloads, so this page lists the kinds it has and nothing it does not.
 */
export default async function StudioTemplatesPage({ params }: PageProps<'/organizations/[organizationId]/studio/templates'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const templates = mayManage ? await listFormTemplates(db) : [];

  return (
    <AppPage>
      <CollectionHeader title={areaLabel('studio-templates')} crumbs={workspaceAncestry(organizationId, 'studio-templates')} />
      {!mayManage ? (
        <Hint>{`Your role, ${organization.role}, cannot create from templates.`}</Hint>
      ) : templates.length === 0 ? (
        <EmptyState title="No templates available" description="Create a blank form from Forms instead." />
      ) : (
        <TemplateList organizationId={organizationId} templates={templates} />
      )}
    </AppPage>
  );
}
