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
import { loadItemEconomics } from '@/lib/application/finance/expected-economics';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { UnitItem } from '@/features/finance/catalog/unit-item';
import { PlanSubscribers, PlanSwitchesEditor } from '@/features/finance/catalog/plan-switches';
import { loadPlanSwitches } from '@/lib/application/finance/plan-switches';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { ButtonLink } from '@/components/controls/button';

export const dynamic = 'force-dynamic';

/**
 * One item in Catalog & Pricing. An item sold per unit shows its price, the Work type that delivers
 * it and what selling one is expected to cost. A recurring item (ADR-057) shows its price history,
 * add-ons and, for an item that sells a GildOps plan, the whole plan record: what it switches on
 * (editable only by members who also hold the Product Registry permission), its usage prices,
 * checkout readiness, its subscribers (`subscription.read`) and its economics (`cost.read`).
 */
export default async function CatalogItemPage({ params }: PageProps<'/organizations/[organizationId]/finance/catalog/[itemId]'>) {
  const { organizationId, itemId } = await params;
  const { db, organization, gate } = await requireOperatingArea(organizationId, 'finance-catalog');
  const unit = await loadItemEconomics(db, { organizationId, itemId });
  if (unit) {
    const has = (capability: (typeof organization.capabilities)[number]) => organization.capabilities.includes(capability);
    const type = unit.item.deliveryTypeId ? (await listWorkItemTypes(db, { organizationId, includeArchived: true })).find((candidate) => candidate.id === unit.item.deliveryTypeId) ?? null : null;
    return (
      <UnitItem
        organizationId={organizationId}
        economics={unit}
        deliveryType={type}
        mayReadCosts={has('cost.read')}
        mayManageCosts={has('cost.manage')}
        mayConfigureWork={has('field.manage')}
      />
    );
  }
  if (!gate.featureAvailability.has('recurring_items')) notFound();
  const model = await loadRecurringItem(db, { organizationId, itemId });
  if (!model) notFound();
  const { item } = model;
  const has = (capability: (typeof organization.capabilities)[number]) => organization.capabilities.includes(capability);
  const mayManage = has('price.manage');
  const [platform, switchModel] = item.plan
    ? await Promise.all([loadPlatformContext(db, organizationId), loadPlanSwitches(db, item.plan.key)])
    : [null, null];
  const mayEditSwitches = Boolean(platform?.permissions.has('platform.catalogue'));
  const maySeeSubscribers = has('subscription.read') && gate.featureAvailability.has('subscriptions');
  const maySimulate = has('cost.read') && gate.featureAvailability.has('package_economics') && item.plan?.kind === 'plan';
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
        actions={mayManage || maySimulate ? (
          <div className="flex flex-wrap gap-2">
            {maySimulate && item.plan ? <ButtonLink href={`/organizations/${organizationId}/finance/economics/packages?source=plan_default&id=${item.plan.id}`} tone="secondary" size="small">Economics</ButtonLink> : null}
            {mayManage ? <EditRecurringItemDrawer organizationId={organizationId} item={item} /> : null}
          </div>
        ) : undefined}
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
      {item.plan && switchModel && mayEditSwitches
        ? <PlanSwitchesEditor target={{ organizationId, itemId: item.id, planId: item.plan.id }} model={switchModel} />
        : item.plan ? <SwitchesSection switches={model.switches} /> : null}
      {item.plan ? (
        <UsagePricesSection organizationId={organizationId} itemId={item.id} allowances={model.allowances} usagePrices={model.usagePrices} mayManage={mayManage} defaultCurrency={defaultCurrency} />
      ) : null}
      {item.plan && switchModel && maySeeSubscribers ? <PlanSubscribers organizationId={organizationId} model={switchModel} /> : null}
    </AppPage>
  );
}
