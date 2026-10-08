import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { SubmissionsView } from '@/features/studio/forms/submissions-view';
import Link from 'next/link';
import { formEditorState, formSubmissionPage } from '@/lib/domain/forms/forms';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function FormSubmissionsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/studio/forms/[formId]/submissions'>) {
  const { organizationId, formId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const query = await searchParams;
  const formsPath = `/organizations/${organizationId}/studio/forms`;

  if (!organization.capabilities.includes('organization.manage')) {
    return (
      <AppPage>
        <PageHeader title="Responses" crumbs={workspaceAncestry(organizationId, 'studio-forms')} />
        <Hint className="mt-5">{`Your role, ${organization.role}, cannot read form responses.`}</Hint>
      </AppPage>
    );
  }

  const requestedPage = Number(query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 40_000_000 ? requestedPage : 1;
  const offset = (page - 1) * 50;
  const [state, read] = await Promise.all([formEditorState(db, organizationId, formId), formSubmissionPage(db, organizationId, formId, offset)]);
  if (!state || !read) notFound();

  return (
    <AppPage>
      <PageHeader
        title={`${state.form.name} · Responses`}
        crumbs={[...workspaceAncestry(organizationId, 'studio-forms'), { label: areaLabel('studio-forms'), href: formsPath }, { label: state.form.name, href: `${formsPath}/${formId}` }]}
      />
      <SubmissionsView key={page} organizationId={organizationId} formId={formId} formName={state.form.name} read={read} offset={offset} initialSelection={typeof query.submission === 'string' ? query.submission : undefined} />
      <nav aria-label="Response pages" className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">Page {page} of {Math.max(1, Math.ceil(read.total / 50))}</span>
        <div className="flex gap-4">{page > 1 ? <Link href={`?page=${page - 1}`} className="text-primary hover:underline">Previous</Link> : null}{offset + read.submissions.length < read.total ? <Link href={`?page=${page + 1}`} className="text-primary hover:underline">Next</Link> : null}</div>
      </nav>
    </AppPage>
  );
}
