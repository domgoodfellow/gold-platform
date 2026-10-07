import { Headset } from 'lucide-react';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function SupportPage({ params }: PageProps<'/organizations/[organizationId]/support'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <WorkspaceHome title={workspaceLabel('support')}>
      <div className="space-y-8">
        <p className="text-sm text-muted-foreground">Support is where this business resolves customer problems, requests and service issues.</p>
        <EmptyState
          media={<Headset className="size-6" aria-hidden="true" />}
          title="No support cases yet."
          description="Requests and issues will appear here once Support records exist. Conversations stay in Communications; customer relationships stay in CRM."
        />
        <Section aria-labelledby="support-operating-areas">
          <SectionHeading id="support-operating-areas">Support operating areas</SectionHeading>
          <p className="mt-2 text-sm text-muted-foreground">These areas describe the scope of this workspace; their workflows are not available yet.</p>
          <dl className="mt-4 divide-y divide-border">
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Cases and requests</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Track the problem or request through its resolution lifecycle.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Queues and assignments</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Organize incoming issues and responsibility for resolving them.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Service levels</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Set expectations for response, priority and escalation.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Resolution</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Record outcomes and how customer problems were resolved.</dd>
            </div>
          </dl>
        </Section>
      </div>
    </WorkspaceHome>
  );
}
