import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { CompactEmptyState } from '@/components/operational/primitives';
import { ButtonLink } from '@/components/controls/button';
import { libraryNewImportHref } from '@/lib/route/library';
import { PricingManagement } from '@/features/pricing/pricing-management';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { RecurringItemsSection } from '@/features/finance/catalog/recurring-items';
import { loadRecurringItems } from '@/lib/application/finance/recurring-items';
import { isOperatingOrganization } from '@/lib/domain/platform/operating-organization';

export const dynamic = 'force-dynamic';

/**
 * Catalog & Pricing: the operating price book — what this business sells and charges, edited in
 * its rows — and, where the business sells them, its recurring items (ADR-057). In GildOps' own
 * organization a recurring item can be a GildOps plan or add-on: this is the one place one is created. A price change reaches new quote lines only; quoted Work and issued invoices keep the
 * snapshot they took. Trading currency is configured in Settings → General, payment collection in Settings → Customer payments.
 */
export default async function FinanceCatalogPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/catalog'>) {
  const { organizationId } = await params;
  const { returnTo } = await searchParams;
  const { db, organization, gate } = await requireOperatingArea(organizationId, 'finance-catalog');
  const sellsRecurring = gate.featureAvailability.has('recurring_items');
  const [items, types, recurring, sellsPlans] = await Promise.all([
    listPriceBookItems(db, { organizationId }),
    listWorkItemTypes(db, { organizationId, includeArchived: true }),
    sellsRecurring ? loadRecurringItems(db, { organizationId }) : Promise.resolve(null),
    // Only the business that sells GildOps creates GildOps plans (ADR-057); the database says so again.
    sellsRecurring ? isOperatingOrganization(db, { organizationId }) : Promise.resolve(false),
  ]);
  const has = (capability: (typeof organization.capabilities)[number]) => organization.capabilities.includes(capability);
  const mayManage = has('price.manage');
  return <AppPage>
    <CollectionHeader title="Catalog & Pricing" crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]} actions={<>{returnTo === 'quote' && has('work_item.price') ? <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/finance/quotes?create=1`}>Return to new quote</ButtonLink> : null}{has('organization.manage') ? <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/settings/payments`}>Payment settings</ButtonLink> : null}{mayManage && has('integration.manage') ? <ButtonLink tone="secondary" size="small" href={libraryNewImportHref(organizationId, undefined, 'price_book')}>Import</ButtonLink> : null}</>} />
    {!organization.currency ? <CompactEmptyState kind="not-configured" action={has('organization.manage') ? <Link className="text-sm font-medium text-accent-text underline-offset-4 hover:underline" href={`/organizations/${organizationId}/settings/general#regional-heading`}>Choose a currency</Link> : undefined}>No trading currency is set, so services cannot be priced yet.</CompactEmptyState> : null}
    <PricingManagement organizationId={organizationId} items={items} currency={organization.currency} mayManage={mayManage} types={types} mayCreate={has('work_item.create') && has('work_item.price')} />
    <p className="mt-3 text-xs text-muted">{mayManage ? 'Changing a price affects new quote lines only. Quoted Work and issued invoices keep their original prices.' : 'Your role can view the catalog but cannot change prices.'}</p>
    {recurring ? <RecurringItemsSection organizationId={organizationId} items={recurring} mayManage={mayManage} sellsPlans={sellsPlans} /> : null}
  </AppPage>;
}
