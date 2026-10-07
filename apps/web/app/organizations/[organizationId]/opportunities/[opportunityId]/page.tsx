import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { RecordHeader } from '@/components/headers/record-header';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { OpportunitySheet } from '@/features/crm/opportunities/opportunity-sheet';
import { OpportunityStageControl } from '@/features/crm/opportunities/stage-controls';
import { ActivityList } from '@/features/timeline/activity-list';
import { getOpportunity, listOpportunityStages } from '@/lib/domain/opportunities/opportunities';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listRecentActivity } from '@/lib/domain/timeline/timeline';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';
export default async function OpportunityPage({ params }: { params: Promise<{ organizationId: string; opportunityId: string }> }) {
  const { organizationId, opportunityId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const item = await getOpportunity(db, { organizationId, opportunityId });
  if (!item) notFound();
  const [stages, members, timeline] = await Promise.all([listOpportunityStages(db, { organizationId }), listMembers(db, { organizationId }), listRecentActivity(db, { organizationId, scope: 'opportunities', opportunityId, limit: 100 })]);
  const mayUpdate = organization.capabilities.includes('opportunity.update');
  return <AppPage>
    <RecordHeader title={item.title} crumbs={[{ label: 'CRM', href: `/organizations/${organizationId}/sales` }, { label: 'Opportunities', href: `/organizations/${organizationId}/opportunities` }, { label: item.title }]} summary={item.stage ? `${item.stage.name} · ${item.stage.kind}` : 'Unstaged'} actions={mayUpdate ? <OpportunitySheet organizationId={organizationId} stages={stages} members={members} defaultCurrency={organization.currency ?? ''} opportunity={item} /> : undefined} />
    <Section><SectionHeading>Details</SectionHeading><dl className="mt-4 grid gap-4 sm:grid-cols-2">
      <div><dt className="text-sm text-muted">Customer</dt><dd><Link className="underline underline-offset-4" href={`/organizations/${organizationId}/customers/${item.customerId}`}>{item.customerName}</Link></dd></div>
      <div><dt className="text-sm text-muted">Value</dt><dd>{item.amountMinor !== null && item.currency ? formatOpportunityValue(item.amountMinor, item.currency) : 'Not set'}</dd></div>
      <div><dt className="text-sm text-muted">Owner</dt><dd>{item.ownerName ?? 'Unassigned'}</dd></div><div><dt className="text-sm text-muted">Expected close</dt><dd>{item.expectedCloseOn ?? 'Not set'}</dd></div>
    </dl>{mayUpdate ? <div className="mt-6 max-w-sm"><OpportunityStageControl organizationId={organizationId} opportunityId={opportunityId} title={item.title} stageId={item.stageId} stages={stages} /></div> : <p className="mt-4 text-sm text-muted">Your role cannot edit opportunities.</p>}</Section>
    <Section className="mt-6"><SectionHeading>Activity</SectionHeading><ActivityList timeline={timeline} timezone={organization.timezone} /></Section>
  </AppPage>;
}
