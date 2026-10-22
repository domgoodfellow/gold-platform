import type { ReactNode } from 'react';
import type { Db } from '@/lib/db/types';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { formatMinutes, listTimeCommitted, totalMinutes } from '@/lib/domain/reporting/commitment';
import { listWorkMarkedComplete, totalJobs } from '@/lib/domain/reporting/completion';
import { listInvoicedAndIncurred, totalsByCurrency } from '@/lib/domain/reporting/financials';
import { periodFor } from '@/lib/domain/reporting/shape';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { listWorkItems } from '@/lib/domain/work-items/work-items';

type Metric = { label: string; value: ReactNode; note?: string };

/** A handful of contextual figures from the domain reads. */
function Metrics({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="divide-y divide-border">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-0.5 py-3 first:pt-0">
            <dt className="text-sm text-muted">{metric.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums tracking-tight">{metric.value}</dd>
            {metric.note ? <dd className="text-xs text-muted">{metric.note}</dd> : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Customers: how many, how many have no stage, and what they were invoiced this month — each from the domain read that owns it. */
export async function CustomersInsights({
  db,
  organizationId,
  today,
  salesEnabled,
}: {
  db: Db;
  organizationId: string;
  today: string;
  salesEnabled: boolean;
}) {
  const period = periodFor('month', today);
  const [customers, unstaged, invoiced] = await Promise.all([
    listContacts(db, { organizationId, limit: 1 }),
    salesEnabled ? listContacts(db, { organizationId, limit: 1, stageId: null }) : Promise.resolve(null),
    listInvoicedAndIncurred(db, { organizationId, grouping: 'customer', period }),
  ]);
  const metrics: Metric[] = [{ label: 'Customers', value: customers.total }];
  if (unstaged) metrics.push({ label: 'Not in a stage', value: unstaged.total });
  for (const total of totalsByCurrency(invoiced)) {
    metrics.push({ label: 'Invoiced this month', value: formatMoney(total.invoicedMinor, total.currency), note: total.currency });
  }

  return (
    <Metrics
      metrics={metrics}
    />
  );
}

/** Work: jobs recorded, jobs marked finished this month and the time committed — the reporting aggregates' own answers. */
export async function WorkInsights({
  db,
  organizationId,
  today,
}: {
  db: Db;
  organizationId: string;
  today: string;
}) {
  const args = { organizationId, grouping: 'customer' as const, period: periodFor('month', today) };
  const [jobs, completed, committed] = await Promise.all([
    listWorkItems(db, { organizationId }),
    listWorkMarkedComplete(db, args),
    listTimeCommitted(db, args),
  ]);

  return (
    <Metrics
      metrics={[
        { label: 'Jobs recorded', value: jobs.total },
        { label: 'Marked complete this month', value: totalJobs(completed) },
        { label: 'Time committed this month', value: formatMinutes(totalMinutes(committed)) },
      ]}
    />
  );
}
