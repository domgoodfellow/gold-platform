import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { OpportunitySheet } from '@/features/crm/opportunities/opportunity-sheet';
import { OpportunityTable } from '@/features/crm/opportunities/opportunity-table';
import { listOpportunities, listOpportunityStages, type OpportunityKind } from '@/lib/domain/opportunities/opportunities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { getCustomer } from '@/lib/domain/customers/customers';
import { requireOrganization } from '@/lib/route/organization';
import { areaHref, workspaceAncestry } from '@/lib/navigation';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';

export const dynamic = 'force-dynamic';
export default async function OpportunitiesPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId } = await params;
  const query = await searchParams;
  const value = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const { db, organization } = await requireOrganization(organizationId);
  const [stages, members, customer] = await Promise.all([listOpportunityStages(db, { organizationId }), listMembers(db, { organizationId }), value('customer') ? getCustomer(db, { organizationId, customerId: value('customer') }) : null]);
  const kind = ['open', 'won', 'lost'].includes(value('kind')) ? value('kind') as OpportunityKind : undefined;
  const page = Math.max(1, Number.parseInt(value('page'), 10) || 1);
  const items = await listOpportunities(db, { organizationId, search: value('q'), stageId: value('stage') === 'unstaged' ? null : value('stage') || undefined, ownerMembershipId: value('owner') === 'unassigned' ? null : value('owner') || undefined, customerId: value('customer') || undefined, noNext:value('next')==='none',closeFrom:value('closeFrom')||undefined,closeBefore:value('closeBefore')||undefined, kind, limit: 50, offset: (page - 1) * 50 });
  const href = areaHref(organizationId, 'opportunities');
  const followUpsEnabled=await followUpsAvailable(db,organizationId);
  const pageHref = (next: number) => { const state = new URLSearchParams(); for (const key of ['q', 'stage', 'owner', 'kind', 'customer','next','closeFrom','closeBefore']) if (value(key)) state.set(key, value(key)); state.set('page', String(next)); return `${href}?${state}`; };
  return <AppPage>
    <CollectionHeader title="Opportunities" crumbs={workspaceAncestry(organizationId, 'opportunities')} actions={<><ButtonLink href={areaHref(organizationId, 'opportunity-pipeline')}>Opportunity pipeline</ButtonLink>{organization.capabilities.includes('opportunity.create') ? <OpportunitySheet organizationId={organizationId} stages={stages} members={members} defaultCurrency={organization.currency ?? ''} customer={customer ?? undefined} /> : null}</>} />
    <form method="get" className="mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5" role="search">
      <FormField id="opportunity-search" label="Search opportunities">{(props) => <TextInput {...props} name="q" type="search" defaultValue={value('q')} />}</FormField>
      <FormField id="opportunity-kind" label="Classification">{(props) => <SelectInput {...props} name="kind" defaultValue={kind ?? ''}><option value="">All</option><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></SelectInput>}</FormField>
      <FormField id="opportunity-stage" label="Opportunity stage">{(props) => <SelectInput {...props} name="stage" defaultValue={value('stage')}><option value="">All stages</option><option value="unstaged">Unstaged</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</SelectInput>}</FormField>
      <FormField id="opportunity-owner" label="Owner">{(props) => <SelectInput {...props} name="owner" defaultValue={value('owner')}><option value="">All owners</option><option value="unassigned">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</SelectInput>}</FormField>
      {value('customer') ? <input name="customer" type="hidden" value={value('customer')} /> : null}<Button type="submit" tone="secondary">Apply filters</Button>
      {['next','closeFrom','closeBefore'].map(key=>value(key)?<input key={key} name={key} type="hidden" value={value(key)}/>:null)}
    </form>
    {value('customer') ? <p className="mb-3 text-sm">Customer: {customer?.name ?? 'Unavailable'} · <ButtonLink tone="text" href={href}>Clear customer filter</ButtonLink></p> : null}
    <OpportunityTable organizationId={organizationId} opportunities={items} timezone={organization.timezone} followUpOptions={followUpsEnabled?{organizationId,timezone:organization.timezone,members,mayManage:organization.capabilities.includes('follow_up.manage')}:undefined}/>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span>{items.total} opportunities · Page {page}</span>{page > 1 ? <ButtonLink href={pageHref(page - 1)}>Previous</ButtonLink> : null}{page * 50 < items.total ? <ButtonLink href={pageHref(page + 1)}>Next</ButtonLink> : null}</div>
  </AppPage>;
}
