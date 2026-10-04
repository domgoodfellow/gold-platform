import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { FormBuilder } from '@/features/studio/forms/form-builder';
import { formEditorState, publicFormPath } from '@/lib/domain/forms/forms';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * One form's workbench. The page loads the form's own state — the published revision, the draft
 * being worked on and the history — through the domain layer, which proves the caller may manage
 * this business's public surfaces; a form id from another business reads as nothing.
 */
export default async function StudioFormPage({ params }: PageProps<'/organizations/[organizationId]/studio/forms/[formId]'>) {
  const { organizationId, formId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('organization.manage')) {
    return (
      <AppPage>
        <PageHeader title={areaLabel('studio-forms')} crumbs={workspaceAncestry(organizationId, 'studio-forms')} />
        <Hint className="mt-5">{`Your role, ${organization.role}, cannot manage forms.`}</Hint>
      </AppPage>
    );
  }

  const state = await formEditorState(db, organizationId, formId);
  if (!state) notFound();

  return (
    <AppPage>
      <PageHeader
        title={state.form.name}
        crumbs={[...workspaceAncestry(organizationId, 'studio-forms'), { label: areaLabel('studio-forms'), href: `/organizations/${organizationId}/studio/forms` }]}
      />
      <FormBuilder
        // Local editing state initializes once per revision pair; a new draft or a publish is a fresh mount.
        key={`${state.working?.id ?? 'none'}:${state.published?.id ?? 'none'}`}
        organizationId={organizationId}
        state={state}
        publicPath={organization.slug ? publicFormPath(organization.slug, state.form.slug) : null}
      />
    </AppPage>
  );
}
