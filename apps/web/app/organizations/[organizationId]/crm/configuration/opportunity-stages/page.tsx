import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { PageHeader } from '@/components/headers/page-header';
import { ConfigurationEditor } from '@/components/patterns/configuration-editor';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { OpportunityStageSheet } from '@/features/crm/opportunities/stage-controls';
import { listOpportunityStages } from '@/lib/domain/opportunities/opportunities';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';
export default async function OpportunityStagesPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'opportunity-stages');
  const stages = await listOpportunityStages(db, { organizationId });
  const mayConfigure = organization.capabilities.includes('field.manage');
  return <SettingsPageFrame><PageHeader title="Opportunity stages" crumbs={[...workspaceConfigCrumbs(organizationId, 'opportunity-stages', gate),]} actions={mayConfigure ? <OpportunityStageSheet organizationId={organizationId} nextPosition={Math.max(-1, ...stages.map((stage) => stage.position)) + 1} /> : undefined} />
    <p className="mb-4 text-sm text-muted">Manage opportunity stages. Relationship stages are configured separately.</p>
    <ConfigurationEditor label="Opportunity stages" items={stages.map((stage) => ({ id: stage.id, label: stage.name, meta: <span className="capitalize">{stage.kind} · position {stage.position}</span>, actions: mayConfigure ? <OpportunityStageSheet organizationId={organizationId} stage={stage} /> : undefined }))}
      empty="No opportunity stages yet. Opportunities can stay unstaged." />
    {!mayConfigure ? <p className="mt-3 text-sm text-muted">Your role cannot configure opportunity stages.</p> : null}
  </SettingsPageFrame>;
}
