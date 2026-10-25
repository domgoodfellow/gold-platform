import Link from 'next/link';
import { SelectInput } from '@/components/controls/inputs';
import { Board, BoardCard, BoardColumn } from '@/components/patterns/board';
import { CollectionToolbar } from '@/components/patterns/collection-toolbar';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ButtonLink } from '@/components/controls/button';
import { OpportunitySheet } from '@/features/crm/opportunities/opportunity-sheet';
import { OpportunityStageControl } from '@/features/crm/opportunities/stage-controls';
import { previewOpportunityPipeline, listOpportunities, listOpportunityStages, summarizeOpportunities } from '@/lib/domain/opportunities/opportunities';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
import { listMembers } from '@/lib/domain/tenancy/members';
import { requireOrganization } from '@/lib/route/organization';
import { areaHref, configTarget } from '@/lib/navigation';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';

export const dynamic = 'force-dynamic';
export default async function OpportunityPipelinePage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const { organizationId } = await params;
  const query = await searchParams;
  const value = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const filtered = ['q','stage','owner','customer'].some(key => value(key));
  const { db, organization } = await requireOrganization(organizationId);
  const [items, stages, summary, members, contacts] = await Promise.all([filtered ? listOpportunities(db, {organizationId,search:value('q'),stageId:value('stage')==='unstaged'?null:value('stage')||undefined,ownerMembershipId:value('owner')==='unassigned'?null:value('owner')||undefined,customerId:value('customer')||undefined,limit:100}) : previewOpportunityPipeline(db, organizationId), listOpportunityStages(db, { organizationId }), summarizeOpportunities(db, { organizationId }), listMembers(db, { organizationId }), listContacts(db,{organizationId})]);
  const mayUpdate = organization.capabilities.includes('opportunity.update');
  const followUpsEnabled=await followUpsAvailable(db,organizationId);
  const collection = areaHref(organizationId, 'opportunities');
  // Unstaged is a real column only when something is in it (or no stages exist yet); configured stages show even when empty.
  const unstagedCount = filtered ? items.filter((item) => item.stageId === null).length : summary.find((item) => item.stageId === null)?.count ?? 0;
  const totalOpportunities = summary.reduce((sum, item) => sum + item.count, 0);
  const columns = [...stages.map((stage) => ({ id: stage.id as string | null, name: stage.name, kind: stage.kind as string })), ...(unstagedCount || !stages.length ? [{ id: null, name: 'Unstaged', kind: '' }] : [])];
  // First run: nothing to arrange yet, so the page offers setup instead of an empty board.
  const firstRun = !stages.length && !totalOpportunities && !filtered;
  const mayConfigureStages = organization.capabilities.includes('field.manage');
  const base = `/organizations/${organizationId}/crm/pipeline`;
  const without = (key: string) => { const params = new URLSearchParams(); for (const name of ['q', 'stage', 'owner', 'customer']) if (name !== key && value(name)) params.set(name, value(name)); const text = params.toString(); return text ? `${base}?${text}` : base; };
  const stageName = (id: string) => id === 'unstaged' ? 'Unstaged' : stages.find(stage => stage.id === id)?.name ?? 'Stage';
  const active = [
    ...(value('q') ? [{ key: 'q', label: `Search: ${value('q')}`, removeHref: without('q') }] : []),
    ...(value('stage') ? [{ key: 'stage', label: `Stage: ${stageName(value('stage'))}`, removeHref: without('stage') }] : []),
    ...(value('owner') ? [{ key: 'owner', label: `Owner: ${value('owner') === 'unassigned' ? 'Unassigned' : members.find(member => member.id === value('owner'))?.displayName ?? 'Member'}`, removeHref: without('owner') }] : []),
    ...(value('customer') ? [{ key: 'customer', label: `Contact: ${contacts.find(contact => contact.id === value('customer'))?.name ?? 'Contact'}`, removeHref: without('customer') }] : []),
  ];
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: organization.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <AppPage>
    <CollectionHeader location={{}} actions={<><ButtonLink tone="secondary" href={collection}>List view</ButtonLink>{organization.capabilities.includes('field.manage') ? <ButtonLink tone="secondary" href={`/organizations/${organizationId}/${configTarget('opportunity-stages').path}`}>Opportunity stages</ButtonLink> : null}{organization.capabilities.includes('opportunity.create') ? <OpportunitySheet organizationId={organizationId} stages={stages} members={members} defaultCurrency={organization.currency ?? ''} /> : null}</>} />
    {firstRun ? null : <CollectionToolbar className="mb-4" action={base} search={{ name: 'q', value: value('q'), label: 'Search opportunities' }} filterCount={['stage', 'owner', 'customer'].filter(key => value(key)).length}
      filters={<>
        <label className="flex flex-col gap-1 text-sm">Stage<SelectInput name="stage" defaultValue={value('stage')}><option value="">All stages</option><option value="unstaged">Unstaged</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</SelectInput></label>
        <label className="flex flex-col gap-1 text-sm">Owner<SelectInput name="owner" defaultValue={value('owner')}><option value="">All owners</option><option value="unassigned">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}</SelectInput></label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">Contact<SelectInput name="customer" defaultValue={value('customer')}><option value="">All contacts</option>{contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</SelectInput></label>
      </>}
      active={active} resetHref={filtered ? base : undefined} />}
    {firstRun ? <section aria-labelledby="pipeline-setup" data-slot="compact-empty" className="flex flex-col gap-3 rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><h2 id="pipeline-setup" className="text-base font-semibold">Set up your pipeline</h2><p className="mt-1 text-sm text-muted">Stages organize opportunities from first conversation to won or lost.</p></div>
      {mayConfigureStages ? <ButtonLink tone="primary" href={`/organizations/${organizationId}/${configTarget('opportunity-stages').path}`}>Configure stages</ButtonLink> : <p className="text-sm text-muted">Someone who manages CRM configuration sets up stages.</p>}
    </section> : <>
    {!stages.length ? <p className="mb-3 text-sm text-muted">No opportunity stages yet, so opportunities are Unstaged.</p> : null}
    <p className="mb-3 text-xs text-muted">{filtered ? 'Up to 100 matching opportunities; counts describe the cards shown. Use List view to page through more.' : 'Up to 10 opportunities per stage, by expected close. Counts and totals include every opportunity.'}</p>
    <Board label="Opportunity stages">
      {columns.map((column) => {
        const totals = filtered ? undefined : summary.find((item) => item.stageId === column.id);
        const cards = items.filter((item) => item.stageId === column.id);
        const count = filtered ? cards.length : totals?.count ?? 0;
        return <BoardColumn key={column.id ?? 'unstaged'} name={column.name} count={count} empty="No opportunities."
          meta={<><span className={column.kind ? 'capitalize' : undefined}>{column.kind || 'No stage assigned'}</span>{totals?.values.map((total) => <span key={total.currency} className="block tabular-nums">{formatOpportunityValue(total.amountMinor, total.currency)}</span>)}</>}
          footer={count > cards.length || filtered ? <Link className="text-xs font-medium text-accent-text underline underline-offset-4" href={`${collection}?stage=${column.id ?? 'unstaged'}`}>View all in {column.name}</Link> : null}>
          {cards.length ? cards.map((item) => <BoardCard key={item.id} actions={mayUpdate ? <OpportunityStageControl organizationId={organizationId} opportunityId={item.id} title={item.title} stageId={item.stageId} stages={stages} /> : undefined}>
            <div className="min-w-0"><Link className="block break-words font-medium hover:underline" href={`${collection}/${item.id}`}>{item.title}</Link><Link className="block truncate text-xs text-muted hover:underline" href={`/organizations/${organizationId}/crm/contacts/${item.customerId}`}>{item.customerName}</Link></div>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
              <dt className="sr-only">Value</dt><dd className="font-medium tabular-nums">{item.amountMinor !== null && item.currency ? formatOpportunityValue(item.amountMinor, item.currency) : <span className="text-muted">No value</span>}</dd>
              <dt className="sr-only">Expected close</dt><dd className="text-right text-muted">{item.expectedCloseOn ? `Closes ${item.expectedCloseOn}` : 'No close date'}</dd>
              <dt className="sr-only">Owner</dt><dd className="col-span-2 text-muted">{item.ownerName ?? 'Unassigned'}</dd>
            </dl>
            {followUpsEnabled ? item.nextFollowUp ? <div className="rounded-md bg-secondary px-2 py-1.5 text-xs"><FollowUpSheet organizationId={organizationId} timezone={organization.timezone} members={members} mayManage={organization.capabilities.includes('follow_up.manage')} reference={item.nextFollowUp} /><p className="mt-0.5 text-muted">{dateFormat.format(new Date(item.nextFollowUp.dueAt))}</p></div> : <p className="text-xs text-muted">No next follow-up</p> : null}
          </BoardCard>) : null}
        </BoardColumn>;
      })}
    </Board>
    </>}
  </AppPage>;
}
