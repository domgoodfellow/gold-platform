import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { LinkItemToTypeForm, StageCostForm } from '@/features/finance/catalog/expected-costs';
import type { ItemEconomics, StageWithCost } from '@/lib/application/finance/expected-economics';
import { marginPercent, stageCostMinor } from '@/lib/domain/pricing/expected-costs';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export type TypePricingData = {
  items: ItemEconomics[];
  stages: StageWithCost[];
  /** Price book items no type delivers yet, which this one could. */
  otherItems: PriceBookItem[];
  currency: string | null;
  mayReadCosts: boolean;
  mayManageCosts: boolean;
  mayManagePrices: boolean;
};

/**
 * What a Work type sells and what doing it costs. The priced items it delivers come from Catalog &
 * Pricing, each with the margin expected from its own costs and this type's stages; each stage
 * carries the time work is expected to spend in it and what the people and equipment busy there
 * cost per hour. Costs are shown only to members who may see them (`cost.read`).
 */
export function TypePricing({ organizationId, typeId, typeName, data }: { organizationId: string; typeId: string; typeName: string; data: TypePricingData }) {
  const { items, stages, otherItems, currency, mayReadCosts, mayManageCosts, mayManagePrices } = data;
  const catalog = `/organizations/${organizationId}/finance/catalog`;
  const costed = stages.filter((stage) => stage.cost);
  const minutes = costed.reduce((total, stage) => total + (stage.cost?.expectedMinutes ?? 0), 0);
  const stageCurrencies = new Set(costed.map((stage) => stage.cost!.currency));
  const stageTotal = stageCurrencies.size === 1 ? costed.reduce((total, stage) => total + stageCostMinor(stage.cost!), 0) : null;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="type-priced-items" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="type-priced-items" className="text-sm font-semibold">Priced items</h3>
          <ButtonLink tone="text" size="small" href={catalog}>Catalog &amp; Pricing</ButtonLink>
        </div>
        {items.length ? (
          <ul aria-label={`Priced items delivered as ${typeName}`} className="flex flex-col divide-y divide-border">
            {items.map(({ item, expected }) => {
              const percent = marginPercent(expected.marginMinor, item.unitAmountMinor);
              return (
                <li key={item.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <span className="min-w-0">
                    <Link href={`${catalog}/${item.id}`} className="font-medium hover:underline">{item.name}</Link>
                    <span className="text-muted"> · {formatMoney(item.unitAmountMinor, item.currency)} per {item.unit}</span>
                  </span>
                  {mayReadCosts ? (
                    <span className="tabular-nums text-muted">
                      {expected.costMinor === null
                        ? expected.issue
                        : `Expected cost ${formatMoney(expected.costMinor, item.currency)} · margin ${formatMoney(expected.marginMinor!, item.currency)}${percent === null ? '' : ` (${percent}%)`}`}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing in the price book is delivered as {typeName}.</p>
        )}
        {mayManagePrices && otherItems.length ? (
          <LinkItemToTypeForm organizationId={organizationId} typeId={typeId} typeName={typeName} items={otherItems.map((item) => ({ id: item.id, name: item.name }))} />
        ) : null}
      </section>

      {mayReadCosts ? (
        <section aria-labelledby="type-stage-costs" className="flex flex-col gap-2">
          <h3 id="type-stage-costs" className="text-sm font-semibold">Time and cost per stage</h3>
          {stages.length ? (
            <>
              <div className="flex flex-col divide-y divide-border">
                {stages.map((stage) => (
                  <StageCostForm
                    key={`${stage.id}:${stage.cost?.expectedMinutes ?? ''}:${stage.cost?.hourlyCostMinor ?? ''}`}
                    organizationId={organizationId}
                    stage={{ id: stage.id, name: stage.name, cost: stage.cost }}
                    currency={currency}
                    mayManage={mayManageCosts}
                  />
                ))}
              </div>
              <p className="border-t border-border pt-2 text-sm tabular-nums">
                Per job: {minutes} min{stageTotal !== null ? ` · ${formatMoney(stageTotal, [...stageCurrencies][0])}` : costed.length ? ' · stage costs are in more than one currency' : ''}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">Add stages in Workflow first.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
