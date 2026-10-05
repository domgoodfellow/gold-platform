import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { NewFormDrawer } from '@/features/studio/forms/new-form-drawer';
import { listForms, placementLabels, stableFormPath, type FormListEntry } from '@/lib/domain/forms/forms';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

function statusOf(form: FormListEntry): string {
  if (form.archived) return 'Archived';
  if (form.publishedRevisionNumber !== null) return form.hasDraft ? `Published · draft in progress` : 'Published';
  return 'Draft';
}

/**
 * Studio → Forms: the forms this business has made, what state each is in and how many responses
 * it has. A list of work, not an introduction — the first thing on an empty page is how to start one.
 */
export default async function StudioFormsPage({ params }: PageProps<'/organizations/[organizationId]/studio/forms'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const forms = mayManage ? await listForms(db, organizationId) : [];
  const base = `/organizations/${organizationId}/studio`;

  return (
    <AppPage>
      <CollectionHeader
        title={areaLabel('studio-forms')}
        crumbs={workspaceAncestry(organizationId, 'studio-forms')}
        actions={mayManage ? (
          <>
            <ButtonLink tone="secondary" href={`${base}/templates`}>Browse templates</ButtonLink>
            <NewFormDrawer organizationId={organizationId} />
          </>
        ) : null}
      />
      {!mayManage ? (
        <Hint>{`Your role, ${organization.role}, cannot manage forms.`}</Hint>
      ) : forms.length === 0 ? (
        <EmptyState
          title="No forms yet"
          description="Create a blank form or start from a template."
          action={
            <div className="flex flex-wrap gap-2">
              <NewFormDrawer organizationId={organizationId} />
              <ButtonLink tone="secondary" href={`${base}/templates`}>Browse templates</ButtonLink>
            </div>
          }
        />
      ) : (
        <DividedList className="text-sm">
          {forms.map((form) => (
            <li key={form.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <div className="min-w-0">
                <Link href={`${base}/forms/${form.id}`} className="font-medium underline-offset-4 hover:underline">{form.name}</Link>
                <p className="text-xs text-subtle">
                  {statusOf(form)}
                  {form.publishedRevisionNumber !== null && !form.archived ? ` · ${stableFormPath(form.publicKey)}` : ''}
                  {placementLabels(form.placements).length > 0 ? ` · Used by ${placementLabels(form.placements).join(', ')}` : ''}
                </p>
              </div>
              <Link href={`${base}/forms/${form.id}/submissions`} className="text-muted underline-offset-4 hover:underline">
                {form.submissionCount === 0 ? 'No responses' : `${form.submissionCount} response${form.submissionCount === 1 ? '' : 's'}`}
                {form.lastSubmittedAt ? ` · last ${new Date(form.lastSubmittedAt).toLocaleDateString()}` : ''}
              </Link>
            </li>
          ))}
        </DividedList>
      )}
    </AppPage>
  );
}
