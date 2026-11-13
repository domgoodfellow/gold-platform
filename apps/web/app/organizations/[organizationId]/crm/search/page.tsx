import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { TextInput } from '@/components/controls/inputs';
import { Button,ButtonLink } from '@/components/controls/button';
import Link from 'next/link';
import { OpportunityTable } from '@/features/crm/opportunities/opportunity-table';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { listOpportunities } from '@/lib/domain/opportunities/opportunities';
import { requireOrganization } from '@/lib/route/organization';
export const dynamic='force-dynamic';
export default async function CrmSearchPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{q?:string}>}) {
  const {organizationId}=await params;const q=await searchParams;const {db,organization}=await requireOrganization(organizationId);
  // Contacts are searched only for a role that may view them; opportunities are searched either way.
  const mayReadContacts=organization.capabilities.includes('customer.read');
  const [customers,opportunities]=await Promise.all([mayReadContacts?listContacts(db,{organizationId,search:q.q,limit:20}):null,listOpportunities(db,{organizationId,search:q.q,limit:20})]);
  const base=`/organizations/${organizationId}`;
  return <AppPage><CollectionHeader location={{}}/><form method="get" className="mb-6 flex gap-2"><TextInput aria-label="Search CRM" type="search" name="q" defaultValue={q.q} placeholder={customers?'Contacts and opportunities':'Opportunities'}/><Button type="submit">Search</Button></form>{customers?<section className="mb-6"><h2 className="mb-3 font-semibold">Contacts · {customers.total}</h2><ul className="divide-y divide-border">{customers.map(c=><li key={c.id} className="py-3 text-sm"><Link href={`${base}/crm/contacts/${c.id}`}>{c.name}</Link><span className="ml-3 text-muted">{c.email}</span></li>)}</ul><ButtonLink tone="text" href={`${base}/crm/contacts?q=${encodeURIComponent(q.q??'')}`}>View all contacts</ButtonLink></section>:null}<section><h2 className="mb-3 font-semibold">Opportunities · {opportunities.total}</h2><OpportunityTable organizationId={organizationId} opportunities={opportunities} timezone={organization.timezone}/><ButtonLink tone="text" href={`${base}/crm/opportunities?q=${encodeURIComponent(q.q??'')}`}>View all opportunities</ButtonLink></section></AppPage>;
}
