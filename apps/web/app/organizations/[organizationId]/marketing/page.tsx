import { Megaphone } from 'lucide-react';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function MarketingPage({ params }: PageProps<'/organizations/[organizationId]/marketing'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <WorkspaceHome title={workspaceLabel('marketing')}>
      <div className="space-y-8">
        <p className="text-sm text-muted-foreground">Marketing is where this business plans and monitors customer acquisition.</p>
        <EmptyState
          media={<Megaphone className="size-6" aria-hidden="true" />}
          title="No marketing activity is configured yet."
          description="Campaign planning and audience activity will appear here when marketing workflows are available."
        />
        <Section aria-labelledby="marketing-operating-areas">
          <SectionHeading id="marketing-operating-areas">Marketing operating areas</SectionHeading>
          <p className="mt-2 text-sm text-muted-foreground">These areas describe the scope of this workspace; their workflows are not available yet.</p>
          <dl className="mt-4 divide-y divide-border">
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Campaigns</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Plan activity that attracts and converts an audience.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Audience</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Define who marketing activity is intended to reach.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Content</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Coordinate campaign content with experiences authored in Studio.</dd>
            </div>
            <div className="py-4 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">Performance</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Understand acquisition results when campaign activity is available.</dd>
            </div>
          </dl>
        </Section>
      </div>
    </WorkspaceHome>
  );
}
