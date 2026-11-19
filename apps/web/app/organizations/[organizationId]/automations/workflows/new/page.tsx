import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { NewWorkflow } from '@/features/automations/create/new-workflow';
import { requireOrganization } from '@/lib/route/organization';
import { areaHref, areaLabel, workspaceAncestry } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

/**
 * Creating a workflow. Only someone who may manage automations reaches it; anyone else gets the
 * same not-found a missing page gives. The page stores nothing: the rule is written by
 * `createRuleAction`, which checks the membership and permission again.
 */
export default async function NewAutomationWorkflowPage({
  params,
}: PageProps<'/organizations/[organizationId]/automations/workflows/new'>) {
  const { organizationId } = await params;
  const { organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('automation.manage')) notFound();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="New workflow"
        crumbs={[
          ...workspaceAncestry(organizationId, 'automation-rules'),
          { label: areaLabel('automation-rules'), href: areaHref(organizationId, 'automation-rules') },
        ]}
      />
      <NewWorkflow organizationId={organizationId} />
    </div>
  );
}
