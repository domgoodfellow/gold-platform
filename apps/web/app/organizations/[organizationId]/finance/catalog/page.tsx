import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { CompactEmptyState } from '@/components/operational/primitives';
import { ButtonLink } from '@/components/controls/button';
import { PricingManagement } from '@/features/pricing/pricing-management';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * Catalog & Pricing: the operating price book — what this business sells and charges, edited in
 * its rows. A price change reaches new quote lines only; quoted Work and issued invoices keep the
 * snapshot they took. Trading currency is configured in Settings → General, payment collection in Settings → Customer payments.
 */
export default async function FinanceCatalogPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/finance/catalog'>) {
  const { organizationId } = await params;
  const { returnTo } = await searchParams;
  const { db, organization } = await requireOperatingArea(organizationId, 'finance-catalog');
  const items = await listPriceBookItems(db, { organizationId });
  const has = (capability: (typeof organization.capabilities)[number]) => organization.capabilities.includes(capability);
  const mayManage = has('price.manage');
  return <AppPage>
    <CollectionHeader title="Catalog & Pricing" crumbs={[{ label: 'Finance', href: `/organizations/${organizationId}/finance` }]} actions={<>{returnTo === 'quote' && has('work_item.price') ? <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/finance/quotes?create=1`}>Return to new quote</ButtonLink> : null}{has('organization.manage') ? <ButtonLink tone="secondary" size="small" href={`/organizations/${organizationId}/settings/payments`}>Payment settings</ButtonLink> : null}</>} />
    {!organization.currency ? <CompactEmptyState kind="not-configured" action={has('organization.manage') ? <Link className="text-sm font-medium text-accent-text underline-offset-4 hover:underline" href={`/organizations/${organizationId}/settings/general#regional-heading`}>Choose a currency</Link> : undefined}>No trading currency is set, so services cannot be priced yet.</CompactEmptyState> : null}
    <PricingManagement organizationId={organizationId} items={items} currency={organization.currency} mayManage={mayManage} />
    <p className="mt-3 text-xs text-muted">{mayManage ? 'Changing a price affects new quote lines only. Quoted Work and issued invoices keep their original prices.' : 'Your role can view the catalog but cannot change prices.'}</p>
  </AppPage>;
}
