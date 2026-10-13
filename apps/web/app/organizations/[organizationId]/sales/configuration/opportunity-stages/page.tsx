import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { PageHeader } from '@/components/headers/page-header';
import { Section, SectionHeading, EmptyState } from '@/components/surfaces/section';
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
    <p className="text-sm text-muted">Stages classify opportunities as Open, Won or Lost. Customer relationship stages are configured separately.</p>
    {!mayConfigure ? <p className="mt-3 text-sm text-muted">Your role cannot configure opportunity stages.</p> : null}
    <Section className="mt-6"><SectionHeading>Configured stages</SectionHeading>{stages.length ? <ul className="mt-3 divide-y divide-border">{stages.map((stage) => <li key={stage.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span>{stage.position} · {stage.name} <span className="text-sm text-muted">({stage.kind})</span></span>{mayConfigure ? <OpportunityStageSheet organizationId={organizationId} stage={stage} /> : null}</li>)}</ul> : <EmptyState>No opportunity stages configured. Opportunities can remain unstaged.</EmptyState>}</Section>
  </SettingsPageFrame>;
}
