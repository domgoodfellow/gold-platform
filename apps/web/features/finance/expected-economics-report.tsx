import Link from 'next/link';
import { DataTable } from '@/components/display/table';
import { OperationalPanel } from '@/components/operational/primitives';
import { InfoPopover } from '@/components/controls/info-popover';
import type { ItemEconomics, TypeEconomics } from '@/lib/application/finance/expected-economics';
import { marginPercent } from '@/lib/domain/pricing/expected-costs';
import { formatMoney } from '@/lib/domain/work-items/consumption';

const average = (total: number, count: number) => (count > 0 ? Math.round(total / count) : null);

/** `2026-11` as "November 2026". */
function monthName(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function range(value: { low: number; high: number }, multiplier: number, currency: string): string {
  const low = formatMoney(value.low * multiplier, currency);
  return value.low === value.high ? low : `${low} – ${formatMoney(value.high * multiplier, currency)}`;
}

/**
 * Finance → Reports: what each priced item is expected to earn from its price and expected costs,
 * and, per Work type, what its finished jobs recorded in the month beside the margin its open work
 * is expected to bring. Expected figures are assumptions; recorded ones come from the jobs.
 */
export function ExpectedEconomicsReport({ organizationId, currency, month, items, types, typeNames }: {
  organizationId: string;
  currency: string;
  month: string;
  items: ItemEconomics[];
  types: TypeEconomics[];
  typeNames: Map<string, string>;
}) {
  const base = `/organizations/${organizationId}`;
  return (
    <>
      <div>
        <OperationalPanel title="Expected margin by item" density="compact" body="edge-to-edge">
          <DataTable
            tableFrom="wide"
            rows={items}
            rowKey={(row) => row.item.id}
            empty="Nothing is priced yet."
            columns={[
              { key: 'item', header: 'Item', emphasis: 'primary', cell: ({ item }) => <Link className="font-medium hover:underline" href={`${base}/finance/catalog/${item.id}`}>{item.name}</Link> },
              { key: 'delivery', header: 'Delivered as', cell: ({ item }) => (item.deliveryTypeId ? typeNames.get(item.deliveryTypeId) ?? '—' : '—') },
              { key: 'price', header: 'Price', numeric: true, cell: ({ item }) => `${formatMoney(item.unitAmountMinor, item.currency)} / ${item.unit}` },
              { key: 'cost', header: 'Expected cost', numeric: true, cell: ({ item, expected }) => (expected.costMinor === null ? <span className="text-muted">{expected.issue}</span> : formatMoney(expected.costMinor, item.currency)) },
              {
                key: 'margin', header: 'Expected margin', numeric: true,
                cell: ({ item, expected }) => {
                  if (expected.marginMinor === null) return <span className="text-muted">Unknown</span>;
                  const percent = marginPercent(expected.marginMinor, item.unitAmountMinor);
                  return <span className={expected.marginMinor < 0 ? 'text-danger' : undefined}>{formatMoney(expected.marginMinor, item.currency)}{percent === null ? '' : ` (${percent}%)`}</span>;
                },
              },
            ]}
          />
        </OperationalPanel>
      </div>

      <div>
        <OperationalPanel
          title="Work types: recorded and expected"
          density="compact"
          body="edge-to-edge"
          action={
            <InfoPopover label="What these figures mean">
              Finished: moved to a finishing stage in {monthName(month)}. Averages are per finished job priced in {currency}, with its recorded costs.
              Open: not finished or let go yet. Expected margin is per job, from the expected costs on each item and its Work type&rsquo;s stages.
            </InfoPopover>
          }
        >
          <DataTable
            tableFrom="wide"
            rows={types}
            rowKey={(row) => row.type.id}
            empty="No work types deliver priced items or have work yet."
            columns={[
              { key: 'type', header: 'Work type', emphasis: 'primary', cell: ({ type }) => <Link className="font-medium hover:underline" href={`${base}/work?type=${type.id}`}>{type.name}</Link> },
              { key: 'finished', header: 'Finished', numeric: true, cell: ({ result }) => result.finishedJobs },
              { key: 'price', header: 'Avg price', numeric: true, cell: ({ result }) => { const value = average(result.pricedMinor, result.pricedJobs); return value === null ? <span className="text-muted">—</span> : formatMoney(value, currency); } },
              { key: 'cost', header: 'Avg cost', numeric: true, cell: ({ result }) => { const value = average(result.costMinor, result.pricedJobs); return value === null ? <span className="text-muted">—</span> : formatMoney(value, currency); } },
              { key: 'recorded', header: 'Avg margin', numeric: true, cell: ({ result }) => { const value = average(result.pricedMinor - result.costMinor, result.pricedJobs); return value === null ? <span className="text-muted">—</span> : <span className={value < 0 ? 'text-danger' : undefined}>{formatMoney(value, currency)}</span>; } },
              { key: 'expected', header: 'Expected margin', numeric: true, cell: ({ expectedMargin }) => (expectedMargin ? range(expectedMargin, 1, currency) : <span className="text-muted">Unknown</span>) },
              { key: 'open', header: 'Open', numeric: true, cell: ({ result }) => result.openJobs },
              { key: 'pipeline', header: 'Expected on open', numeric: true, cell: ({ result, expectedMargin }) => (result.openJobs === 0 ? <span className="text-muted">—</span> : expectedMargin ? range(expectedMargin, result.openJobs, currency) : <span className="text-muted">Unknown</span>) },
            ]}
          />
        </OperationalPanel>
      </div>
    </>
  );
}
