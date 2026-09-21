import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cx, FOCUS_RING } from '@/components/class-names';
import type { Db } from '@/lib/db/types';
import { listCustomers } from '@/lib/domain/customers/customers';
import { formatMinutes, listTimeCommitted, totalMinutes } from '@/lib/domain/reporting/commitment';
import { listWorkMarkedComplete, totalJobs } from '@/lib/domain/reporting/completion';
import { listInvoicedAndIncurred, totalsByCurrency } from '@/lib/domain/reporting/financials';
import { periodFor } from '@/lib/domain/reporting/shape';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { areaHref } from '@/lib/navigation';

type Metric = { label: string; value: ReactNode; note?: string };

/**
 * A handful of figures and one way out to the full report. Small on purpose: no table, no
 * multi-series chart, no filters — those are Insights' job, and the link carries the same
 * measure, grouping and period into it.
 */
function Metrics({ metrics, href, hrefLabel }: { metrics: Metric[]; href: string; hrefLabel: string }) {
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
      <Link href={href} className={cx('flex items-center gap-1 self-start rounded text-sm underline-offset-4 hover:underline', FOCUS_RING)}>
        {hrefLabel}
        <ArrowRight aria-hidden size={14} />
      </Link>
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
    listCustomers(db, { organizationId, limit: 1 }),
    salesEnabled ? listCustomers(db, { organizationId, limit: 1, stageId: null }) : Promise.resolve(null),
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
      href={`${areaHref(organizationId, 'insights')}/reports?of=invoiced_and_incurred&by=customer&period=month`}
      hrefLabel="Open in Insights"
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
      href={`${areaHref(organizationId, 'insights')}/reports?of=work_marked_complete&by=customer&period=month`}
      hrefLabel="Open in Insights"
    />
  );
}
