import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { RecordHeader } from '@/components/headers/record-header';
import { CardSection } from '@/components/surfaces/card';
import { ExpectedCostLines } from '@/features/finance/catalog/expected-costs';
import type { ItemEconomics } from '@/lib/application/finance/expected-economics';
import { marginPercent, stageCostMinor } from '@/lib/domain/pricing/expected-costs';
import type { WorkItemType } from '@/lib/domain/work-items/types';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * One item sold per unit: its price, the Work type that delivers it, and what selling one is
 * expected to cost — its own cost lines plus the time and cost of each stage of that Work type —
 * against its price. Costs appear only for members who may see them (`cost.read`); stage figures are
 * edited on the Work type, where the stages are.
 */
export function UnitItem({ organizationId, economics, deliveryType, mayReadCosts, mayManageCosts, mayConfigureWork }: {
  organizationId: string;
  economics: ItemEconomics;
  deliveryType: WorkItemType | null;
  mayReadCosts: boolean;
  mayManageCosts: boolean;
  mayConfigureWork: boolean;
}) {
  const { item, lines, stages, expected } = economics;
  const base = `/organizations/${organizationId}`;
  const typeHref = deliveryType
    ? mayConfigureWork ? `${base}/work/configuration?type=${deliveryType.id}&tab=pricing` : `${base}/work?type=${deliveryType.id}`
    : null;
  const percent = marginPercent(expected.marginMinor, item.unitAmountMinor);
  const costedStages = stages.filter((stage) => stage.cost);

  return (
    <AppPage>
      <RecordHeader
        title={item.name}
        crumbs={[
          { label: 'Finance', href: `${base}/finance` },
          { label: 'Catalog & Pricing', href: `${base}/finance/catalog` },
          { label: item.name },
        ]}
        summary={<span className="tabular-nums">{formatMoney(item.unitAmountMinor, item.currency)} per {item.unit}</span>}
      />

      <CardSection title="Delivery" className="mt-6">
        <p className="text-sm">
          {deliveryType && typeHref ? <>Delivered as <Link href={typeHref} className="font-medium text-accent-text hover:underline">{deliveryType.name}</Link>{deliveryType.archivedAt ? ' (archived)' : ''}.</> : 'Not delivered as work.'}
        </p>
      </CardSection>

      {mayReadCosts ? (
        <CardSection title="Expected cost" className="mt-6">
          <div className="flex flex-col gap-6">
            <section aria-labelledby="expected-item-costs" className="flex flex-col gap-2">
              <h3 id="expected-item-costs" className="text-sm font-semibold">Per {item.unit}</h3>
              <ExpectedCostLines organizationId={organizationId} itemId={item.id} itemName={item.name} currency={item.currency} lines={lines} mayManage={mayManageCosts} />
            </section>

            {deliveryType ? (
              <section aria-labelledby="expected-stage-costs" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="expected-stage-costs" className="text-sm font-semibold">{deliveryType.name} stages</h3>
                  {mayConfigureWork && typeHref ? <Link href={typeHref} className="text-sm text-accent-text hover:underline">Edit stage costs</Link> : null}
                </div>
                {costedStages.length ? (
                  <ul aria-label={`Expected time and cost of ${deliveryType.name}`} className="flex flex-col divide-y divide-border">
                    {costedStages.map((stage) => (
                      <li key={stage.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                        <span className="min-w-0 flex-1">{stage.name}</span>
                        <span className="tabular-nums text-muted">{stage.cost!.expectedMinutes} min at {formatMoney(stage.cost!.hourlyCostMinor, stage.cost!.currency)}/h</span>
                        <span className="w-24 text-right tabular-nums">{formatMoney(stageCostMinor(stage.cost!), stage.cost!.currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No stage has an expected time yet.</p>
                )}
              </section>
            ) : null}

            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
              <dt className="text-muted">Price</dt>
              <dd className="text-right tabular-nums">{formatMoney(item.unitAmountMinor, item.currency)}</dd>
              <dt className="text-muted">Expected cost</dt>
              <dd className="text-right tabular-nums">{expected.costMinor === null ? 'Unknown' : formatMoney(expected.costMinor, item.currency)}</dd>
              <dt className="font-medium">Expected margin</dt>
              <dd className="text-right font-medium tabular-nums">{expected.marginMinor === null ? 'Unknown' : `${formatMoney(expected.marginMinor, item.currency)}${percent === null ? '' : ` (${percent}%)`}`}</dd>
            </dl>
            {expected.issue && expected.costMinor === null && (lines.length || costedStages.length) ? <p role="status" className="text-sm text-danger">{expected.issue}</p> : null}
          </div>
        </CardSection>
      ) : null}
    </AppPage>
  );
}
