import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { OpportunitySheet } from '@/features/crm/opportunities/opportunity-sheet';
import { OpportunityStageControl } from '@/features/crm/opportunities/stage-controls';
import { previewOpportunityPipeline, listOpportunityStages, summarizeOpportunities } from '@/lib/domain/opportunities/opportunities';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { areaHref, workspaceAncestry, configTarget } from '@/lib/navigation';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';

export const dynamic = 'force-dynamic';
export default async function OpportunityPipelinePage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [items, stages, summary, members] = await Promise.all([previewOpportunityPipeline(db, organizationId), listOpportunityStages(db, { organizationId }), summarizeOpportunities(db, { organizationId }), listMembers(db, { organizationId })]);
  const mayUpdate = organization.capabilities.includes('opportunity.update');
  const followUpsEnabled=await followUpsAvailable(db,organizationId);
  const collection = areaHref(organizationId, 'opportunities');
  const columns = [...stages.map((stage) => ({ id: stage.id as string | null, name: stage.name, kind: stage.kind as string })), { id: null, name: 'Unstaged', kind: '' }];
  return <AppPage>
    <CollectionHeader title="Opportunity pipeline" crumbs={workspaceAncestry(organizationId, 'opportunity-pipeline')} actions={<><ButtonLink href={collection}>Opportunities</ButtonLink>{organization.capabilities.includes('field.manage') ? <ButtonLink href={`/organizations/${organizationId}/${configTarget('opportunity-stages').path}`}>Opportunity stages</ButtonLink> : null}{organization.capabilities.includes('opportunity.create') ? <OpportunitySheet organizationId={organizationId} stages={stages} members={members} defaultCurrency={organization.currency ?? ''} /> : null}</>} />
    {!stages.length ? <p className="mb-4 text-sm text-muted">No opportunity stages configured. Opportunities remain unstaged until a stage is assigned.</p> : null}
    <p className="mb-4 text-xs text-muted">Up to 10 opportunities per stage, ordered by expected close. Counts and currency totals include every opportunity.</p>
    <div className="flex min-w-0 gap-4 overflow-x-auto pb-4" aria-label="Opportunity stages">
      {columns.map((column) => {
        const totals = summary.find((item) => item.stageId === column.id);
        const cards = items.filter((item) => item.stageId === column.id);
        return <section key={column.id ?? 'unstaged'} className="w-80 shrink-0 overflow-hidden rounded-xl border border-border bg-surface p-3" aria-label={column.name}>
          <div className="mb-3 flex items-start justify-between gap-2 border-b border-border pb-3"><div><h2 className="font-semibold">{column.name}</h2><p className={`text-xs capitalize ${column.kind==='won'?'text-success':column.kind==='lost'?'text-muted':'text-muted'}`}>{column.kind || 'No stage assigned'}</p></div><span className="rounded-md bg-background px-2 py-0.5 text-sm font-semibold tabular-nums">{totals?.count ?? 0}</span></div>
          {totals?.values.map((value) => <p key={value.currency} className="mb-2 text-xs tabular-nums text-muted">{formatOpportunityValue(value.amountMinor, value.currency)}</p>)}
          <div className="space-y-3">{cards.map((item) => <article key={item.id} className="space-y-3 rounded-xl border border-border bg-background p-4 shadow-sm">
            <div><Link className="break-words font-medium underline underline-offset-4" href={`${collection}/${item.id}`}>{item.title}</Link><p className="mt-1 text-sm text-muted">{item.customerName}</p></div>
            <p className="text-sm tabular-nums">{item.amountMinor !== null && item.currency ? formatOpportunityValue(item.amountMinor, item.currency) : 'Value not set'}</p>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{item.ownerName ?? 'Unassigned'}</span><span>{item.expectedCloseOn ? `Closes ${item.expectedCloseOn}` : 'Close date not set'}</span></div>
            {item.nextFollowUp ? <div className="rounded-md bg-surface p-2 text-xs">{followUpsEnabled?<FollowUpSheet organizationId={organizationId} timezone={organization.timezone} members={members} mayManage={organization.capabilities.includes('follow_up.manage')} reference={item.nextFollowUp}/>:<p className="font-medium">{item.nextFollowUp.title}</p>}<p className="mt-1 text-muted">{new Intl.DateTimeFormat('en-CA',{timeZone:organization.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(item.nextFollowUp.dueAt))}</p></div> : <p className="text-xs text-muted">No next follow-up</p>}
            {mayUpdate ? <OpportunityStageControl organizationId={organizationId} opportunityId={item.id} title={item.title} stageId={item.stageId} stages={stages} /> : null}
          </article>)}</div>
          {!cards.length ? <p className="py-8 text-center text-sm text-muted">No opportunities in this stage.</p> : null}
          <ButtonLink tone="text" href={`${collection}?stage=${column.id ?? 'unstaged'}`}>View all in {column.name}</ButtonLink>
        </section>;
      })}
    </div>
  </AppPage>;
}
