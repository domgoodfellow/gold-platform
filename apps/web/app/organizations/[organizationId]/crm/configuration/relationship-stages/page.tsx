import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { PageHeader } from '@/components/headers/page-header';
import { Hint } from '@/components/controls/inputs';
import { ConfigurationEditor } from '@/components/patterns/configuration-editor';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { DeleteStageControl, RelationshipStageDialog, StageMoveControls } from '@/features/crm/sales/relationship-stage-editor';
import { customerStageUsage, listCustomerStages } from '@/lib/domain/customers/stages';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * CRM's relationship stages, managed in place: the page is the authoritative ordered list, with
 * add and rename in a focused dialog, Move up / Move down for order, and removal only for a stage no
 * contact uses. Relationship stages are independent of contact lifecycle and of opportunity stages.
 */
export default async function SalesStagesSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/crm/configuration/relationship-stages'>) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'sales-stages');
  const [stages, usage] = await Promise.all([listCustomerStages(db, { organizationId }), customerStageUsage(db, organizationId)]);
  const mayConfigure = organization.capabilities.includes('field.manage');

  return (
    <SettingsPageFrame>
      <PageHeader
        title="Relationship stages"
        crumbs={[...workspaceConfigCrumbs(organizationId, 'sales-stages', gate)]}
        actions={mayConfigure ? <RelationshipStageDialog organizationId={organizationId} triggerTone="primary" /> : null}
      />
      <p className="mb-4 text-sm text-muted">Name the stages your customer relationships move through.</p>
      <ConfigurationEditor
        label="Relationship stages"
        density="compact"
        items={stages.map((stage, index) => {
          const used = usage.get(stage.id) ?? 0;
          return {
            id: stage.id,
            label: stage.name,
            meta: used ? `${used} contact${used === 1 ? '' : 's'} · move them before removing` : 'No contacts',
            actions: mayConfigure ? <>
              <StageMoveControls organizationId={organizationId} stage={stage} first={index === 0} last={index === stages.length - 1} />
              <RelationshipStageDialog organizationId={organizationId} stage={stage} />
              {used ? null : <DeleteStageControl organizationId={organizationId} stage={stage} />}
            </> : undefined,
          };
        })}
        empty="No relationship stages yet."
      />
      {!mayConfigure ? <Hint className="mt-3">Your role, {organization.role}, cannot change relationship stages.</Hint> : null}
    </SettingsPageFrame>
  );
}
