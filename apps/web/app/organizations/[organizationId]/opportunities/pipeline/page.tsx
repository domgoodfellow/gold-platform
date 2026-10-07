import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { OpportunitySheet } from '@/features/crm/opportunities/opportunity-sheet';
import { OpportunityStageControl } from '@/features/crm/opportunities/stage-controls';
import { listOpportunities, listOpportunityStages, summarizeOpportunities } from '@/lib/domain/opportunities/opportunities';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { areaHref, workspaceAncestry, configTarget } from '@/lib/navigation';

export const dynamic = 'force-dynamic';
export default async function OpportunityPipelinePage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<{ page?: string }> }) {
  const { organizationId } = await params;
  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? '', 10) || 1);
  const { db, organization } = await requireOrganization(organizationId);
  const [items, stages, summary, members] = await Promise.all([listOpportunities(db, { organizationId, limit: 50, offset: (page - 1) * 50 }), listOpportunityStages(db, { organizationId }), summarizeOpportunities(db, { organizationId }), listMembers(db, { organizationId })]);
  const mayUpdate = organization.capabilities.includes('opportunity.update');
  const collection = areaHref(organizationId, 'opportunities');
  const pipeline = areaHref(organizationId, 'opportunity-pipeline');
  const columns = [...stages.map((stage) => ({ id: stage.id as string | null, name: stage.name, kind: stage.kind as string })), { id: null, name: 'Unstaged', kind: '' }];
  return <AppPage>
    <CollectionHeader title="Opportunity pipeline" crumbs={workspaceAncestry(organizationId, 'opportunity-pipeline')} actions={<><ButtonLink href={collection}>Opportunities</ButtonLink>{organization.capabilities.includes('field.manage') ? <ButtonLink href={`/organizations/${organizationId}/${configTarget('opportunity-stages').path}`}>Opportunity stages</ButtonLink> : null}{organization.capabilities.includes('opportunity.create') ? <OpportunitySheet organizationId={organizationId} stages={stages} members={members} defaultCurrency={organization.currency ?? ''} /> : null}</>} />
    {!stages.length ? <p className="mb-4 text-sm text-muted">No opportunity stages configured. Opportunities remain unstaged until a stage is assigned.</p> : null}
    <p className="mb-3 text-sm text-muted">Showing {items.length} of {items.total} opportunities, newest first · Page {page}. Stage counts and values include all opportunities.</p>
    <div className="flex min-w-0 gap-4 overflow-x-auto pb-4" aria-label="Opportunity stages">
      {columns.map((column) => {
        const totals = summary.find((item) => item.stageId === column.id);
        const cards = items.filter((item) => item.stageId === column.id);
        return <section key={column.id ?? 'unstaged'} className="w-72 shrink-0 rounded-lg border border-border bg-surface p-3" aria-label={column.name}>
          <div className="mb-3 flex items-start justify-between gap-2"><div><h2 className="font-semibold">{column.name}</h2><p className="text-xs capitalize text-muted">{column.kind}</p></div><span className="text-sm tabular-nums">{totals?.count ?? 0}</span></div>
          {totals?.values.map((value) => <p key={value.currency} className="mb-2 text-xs tabular-nums text-muted">{formatOpportunityValue(value.amountMinor, value.currency)}</p>)}
          <div className="space-y-3">{cards.map((item) => <article key={item.id} className="space-y-3 rounded-md border border-border bg-background p-3">
            <div><Link className="break-words font-medium underline underline-offset-4" href={`${collection}/${item.id}`}>{item.title}</Link><p className="mt-1 text-sm text-muted">{item.customerName}</p></div>
            <p className="text-sm tabular-nums">{item.amountMinor !== null && item.currency ? formatOpportunityValue(item.amountMinor, item.currency) : 'Value not set'}</p>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{item.ownerName ?? 'Unassigned'}</span><span>{item.expectedCloseOn ? `Closes ${item.expectedCloseOn}` : 'Close date not set'}</span></div>
            {mayUpdate ? <OpportunityStageControl organizationId={organizationId} opportunityId={item.id} title={item.title} stageId={item.stageId} stages={stages} /> : null}
          </article>)}</div>
          {!cards.length ? <p className="py-4 text-sm text-muted">No opportunities on this page.</p> : null}
          <ButtonLink tone="text" href={`${collection}?stage=${column.id ?? 'unstaged'}`}>View all in {column.name}</ButtonLink>
        </section>;
      })}
    </div>
    <div className="mt-3 flex gap-2">{page > 1 ? <ButtonLink href={`${pipeline}?page=${page - 1}`}>Previous</ButtonLink> : null}{page * 50 < items.total ? <ButtonLink href={`${pipeline}?page=${page + 1}`}>Next</ButtonLink> : null}</div>
  </AppPage>;
}
