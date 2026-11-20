import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { RecordHeader } from '@/components/headers/record-header';
import { Badge } from '@/components/display/data';
import {
  AddonsSection,
  EditRecurringItemDrawer,
  PriceHistory,
  SwitchesSection,
  UsagePricesSection,
} from '@/features/finance/catalog/recurring-items';
import { priceText } from '@/lib/domain/pricing/recurring-items';
import { loadRecurringItem } from '@/lib/application/finance/recurring-items';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * One recurring item in Catalog & Pricing (ADR-057): its price history, add-ons and, for an item
 * that sells a GildOps plan, what the plan switches on, its usage prices and checkout readiness.
 */
export default async function RecurringItemPage({ params }: PageProps<'/organizations/[organizationId]/finance/catalog/[itemId]'>) {
  const { organizationId, itemId } = await params;
  const { db, organization, gate } = await requireOperatingArea(organizationId, 'finance-catalog');
  if (!gate.featureAvailability.has('recurring_items')) notFound();
  const model = await loadRecurringItem(db, { organizationId, itemId });
  if (!model) notFound();
  const { item } = model;
  const mayManage = organization.capabilities.includes('price.manage');
  const defaultCurrency = model.current[0]?.currency ?? organization.currency ?? '';
  const kind = item.plan ? (item.plan.kind === 'plan' ? 'Plan' : 'Add-on') : null;

  return (
    <AppPage>
      <RecordHeader
        title={item.name}
        crumbs={[
          { label: 'Finance', href: `/organizations/${organizationId}/finance` },
          { label: 'Catalog & Pricing', href: `/organizations/${organizationId}/finance/catalog` },
          { label: item.name },
        ]}
        summary={
          <span className="flex flex-wrap items-center gap-2">
            {kind ? <Badge tone="accent">{kind}</Badge> : null}
            {item.saleStatus === 'unlisted' ? <Badge>Not offered</Badge> : item.saleStatus === 'archived' ? <Badge>Retired</Badge> : null}
            <span>{model.current.length > 0 ? model.current.map(priceText).join(' · ') : 'No price'}</span>
          </span>
        }
        actions={mayManage ? <EditRecurringItemDrawer organizationId={organizationId} item={item} /> : undefined}
      />
      {item.description ? <p className="mt-2 max-w-prose text-sm">{item.description}</p> : null}
      <PriceHistory
        organizationId={organizationId}
        item={item}
        prices={model.prices}
        current={model.current}
        mayManage={mayManage}
        environment={model.environment}
        providerByPrice={model.providerByPrice}
        defaultCurrency={defaultCurrency}
      />
      {model.mayCarryAddons ? (
        <AddonsSection organizationId={organizationId} itemId={item.id} addons={model.addons} options={model.addonOptions} mayManage={mayManage} />
      ) : null}
      {item.plan ? <SwitchesSection switches={model.switches} /> : null}
      {item.plan ? (
        <UsagePricesSection organizationId={organizationId} itemId={item.id} allowances={model.allowances} usagePrices={model.usagePrices} mayManage={mayManage} defaultCurrency={defaultCurrency} />
      ) : null}
    </AppPage>
  );
}
