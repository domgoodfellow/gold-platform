import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { Hint, TextInput, SelectInput } from '@/components/controls/inputs';
import { EmptyState } from '@/components/surfaces/section';
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
export default async function StudioFormsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/studio/forms'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const forms = mayManage ? await listForms(db, organizationId) : [];
  const query = await searchParams;
  const term = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  const status = typeof query.status === 'string' ? query.status : 'all';
  const sort = typeof query.sort === 'string' ? query.sort : 'updated';
  const filtered = forms.filter((form) => (!term || form.name.toLowerCase().includes(term)) &&
    (status === 'archived' ? form.archived : !form.archived && (status === 'draft' ? form.publishedRevisionNumber === null : status === 'changes' ? form.hasDraft && form.publishedRevisionNumber !== null : status === 'published' ? form.publishedRevisionNumber !== null : true)));
  filtered.sort((a, b) => sort === 'responses' ? b.submissionCount - a.submissionCount : sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));
  const pageNumber = Math.min(Math.max(1, Math.floor(Number(query.page)) || 1), Math.max(1, Math.ceil(filtered.length / 25)));
  const rows = filtered.slice((pageNumber - 1) * 25, pageNumber * 25);
  const pageHref = (page: number) => `?${new URLSearchParams({ q: term, status, sort, page: String(page) })}`;
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
        <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface" aria-label="Forms collection">
          <form className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <TextInput name="q" type="search" aria-label="Search forms" placeholder="Search forms..." defaultValue={term} className="w-full sm:w-60" />
            <SelectInput name="status" aria-label="Publication status" defaultValue={status}>
              <option value="all">All active</option><option value="draft">Draft</option><option value="published">Published</option><option value="changes">Published with changes</option><option value="archived">Archived</option>
            </SelectInput>
            <SelectInput name="sort" aria-label="Sort forms" defaultValue={sort}><option value="updated">Recently updated</option><option value="name">Name</option><option value="responses">Most responses</option></SelectInput>
            <button className="rounded-md border border-border px-3 py-2 text-sm hover:bg-hover">Apply</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:whitespace-nowrap [&_th]:px-4 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted">
              <thead className="border-b border-border bg-secondary"><tr><th>Form</th><th>Publication</th><th>Revision</th><th>Responses</th><th>Last response</th><th>Placement</th><th>Updated</th><th>Actions</th></tr></thead>
              <tbody className="divide-y divide-border">{rows.map((form) => <tr key={form.id} className="hover:bg-hover">
                <td><Link href={`${base}/forms/${form.id}`} className="font-medium text-primary hover:underline">{form.name}</Link></td>
                <td><span className="inline-flex whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs">{statusOf(form)}</span></td>
                <td className="whitespace-nowrap text-xs">{form.publishedRevisionNumber === null ? 'Draft' : `v${form.publishedRevisionNumber}`}</td>
                <td><Link href={`${base}/forms/${form.id}/submissions`} className="text-primary hover:underline">{form.submissionCount}</Link></td>
                <td className="whitespace-nowrap text-xs text-muted">{form.lastSubmittedAt ? new Date(form.lastSubmittedAt).toLocaleDateString('en-CA', { timeZone: organization.timezone }) : 'None yet'}</td>
                <td className="text-xs text-muted">{placementLabels(form.placements).join(', ') || 'Not placed'}</td>
                <td className="whitespace-nowrap text-xs text-muted">{new Date(form.updatedAt).toLocaleDateString('en-CA', { timeZone: organization.timezone })}</td>
                <td><div className="flex gap-3 text-xs"><Link href={`${base}/forms/${form.id}`} className="text-primary hover:underline">Edit</Link>{form.publishedRevisionNumber !== null && !form.archived ? <Link href={stableFormPath(form.publicKey)} target="_blank" className="text-primary hover:underline">View</Link> : null}</div></td>
              </tr>)}</tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className="p-8 text-center text-sm text-muted">No forms match these filters.</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted"><span>{filtered.length} forms - Page {pageNumber} of {Math.max(1, Math.ceil(filtered.length / 25))}</span><div className="flex gap-3">{pageNumber > 1 ? <Link href={pageHref(pageNumber - 1)}>Previous</Link> : null}{pageNumber * 25 < filtered.length ? <Link href={pageHref(pageNumber + 1)}>Next</Link> : null}</div></div>
        </section>
      )}
    </AppPage>
  );
}
