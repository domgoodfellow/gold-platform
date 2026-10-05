import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { SubmissionsView } from '@/features/studio/forms/submissions-view';
import { formEditorState, listFormSubmissions } from '@/lib/domain/forms/forms';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function FormSubmissionsPage({ params }: PageProps<'/organizations/[organizationId]/studio/forms/[formId]/submissions'>) {
  const { organizationId, formId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const formsPath = `/organizations/${organizationId}/studio/forms`;

  if (!organization.capabilities.includes('organization.manage')) {
    return (
      <AppPage>
        <PageHeader title="Responses" crumbs={workspaceAncestry(organizationId, 'studio-forms')} />
        <Hint className="mt-5">{`Your role, ${organization.role}, cannot read form responses.`}</Hint>
      </AppPage>
    );
  }

  const [state, read] = await Promise.all([formEditorState(db, organizationId, formId), listFormSubmissions(db, organizationId, formId)]);
  if (!state || !read) notFound();

  return (
    <AppPage>
      <PageHeader
        title={`${state.form.name} · Responses`}
        crumbs={[...workspaceAncestry(organizationId, 'studio-forms'), { label: areaLabel('studio-forms'), href: formsPath }, { label: state.form.name, href: `${formsPath}/${formId}` }]}
      />
      <SubmissionsView organizationId={organizationId} formId={formId} formName={state.form.name} read={read} />
    </AppPage>
  );
}
