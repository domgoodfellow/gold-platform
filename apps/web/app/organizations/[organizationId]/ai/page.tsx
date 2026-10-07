import { Bot } from 'lucide-react';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function AiPage({ params }: PageProps<'/organizations/[organizationId]/ai'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <WorkspaceHome title={workspaceLabel('ai')}>
      <div className="space-y-8">
        <p className="text-sm text-muted-foreground">Manage how AI operates for this business.</p>
        <EmptyState
          media={<Bot className="size-6" aria-hidden="true" />}
          title="No AI workspace activity yet."
          description="This Home establishes the business's AI operating areas. Agents, knowledge usage and activity will appear as tenant AI workflows become available."
        />
        <Section aria-labelledby="ai-operating-areas">
          <SectionHeading id="ai-operating-areas">AI operating areas</SectionHeading>
          <p className="mt-2 text-sm text-muted-foreground">These areas describe the scope of this workspace; their workflows are not available yet.</p>
          <dl className="mt-4 divide-y divide-border">
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Agents and assistants</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Define the AI capabilities that serve this business.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Knowledge access</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Understand which authorized business knowledge AI can use.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Automations using AI</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Understand AI behavior within workflows owned by Automations.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Activity, evaluations and usage</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Review AI actions, their quality and business usage as activity becomes available.</dd>
            </div>
          </dl>
        </Section>
      </div>
    </WorkspaceHome>
  );
}
