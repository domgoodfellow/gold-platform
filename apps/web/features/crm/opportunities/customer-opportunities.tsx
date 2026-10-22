import { ButtonLink } from '@/components/controls/button';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { OpportunitySheet } from './opportunity-sheet';
import { OpportunityTable } from './opportunity-table';
import type { OpportunityFormOptions } from './opportunity-sheet';
import type { Opportunity } from '@/lib/domain/opportunities/opportunities';
export function CustomerOpportunities({ customer, items, total, mayCreate, ...options }: OpportunityFormOptions & { customer: { id: string; name: string }; items: Opportunity[]; total: number; mayCreate: boolean }) {
  return <Section><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><SectionHeading>Opportunities ({total})</SectionHeading>{mayCreate ? <OpportunitySheet {...options} customer={customer} /> : null}</div>
    <OpportunityTable organizationId={options.organizationId} opportunities={items} />
    <ButtonLink tone="text" href={`/organizations/${options.organizationId}/crm/opportunities?customer=${customer.id}`}>View all customer opportunities</ButtonLink>
  </Section>;
}
