import type { ChartData } from '@/lib/chart-model';
import type { FinanceSummary } from '@/lib/domain/billing/finance-reads';
import type { FinancialGroup } from '@/lib/domain/reporting/financials';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * Finance chart data from the existing read model — never a second aggregation. Every exact label
 * is `formatMoney`'s; every chart holds one currency, and several currencies become separate
 * variants a person chooses between, never one total. Each function names its source.
 */
export type ChartVariants = { key: string; label: string; data: ChartData }[];
const money = (minor: number | null, currency: string) => ({ value: minor, label: minor === null ? 'Unknown' : formatMoney(minor, currency) });
const currencies = (rows: { currency: string }[]) => [...new Set(rows.map(row => row.currency))].sort();
const dayLabel = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));

/**
 * Payments received by received day, from `finance_dashboard_summary.trend` (net of corrections,
 * so a correction day can be negative). Only days with recorded payments are listed; the chart
 * spaces them by date. Never called revenue: this is money recorded as received.
 */
export function paymentsTrendCharts(trend: FinanceSummary['trend'], periodLabel: string): ChartVariants {
  return currencies(trend).map(currency => {
    const days = trend.filter(row => row.currency === currency).sort((a, b) => a.day.localeCompare(b.day));
    return { key: currency, label: currency, data: {
      shape: 'time-series', format: { kind: 'money', currency }, period: `${periodLabel} · by received date, net of corrections`, categoryLabel: 'Day',
      categories: days.map(row => ({ key: row.day, label: dayLabel(row.day), at: row.day })),
      series: [{ id: 'received', label: 'Received', points: days.map(row => money(Number(row.amount), currency)) }],
    } };
  });
}

const AGING_ORDER = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', '90+ days', 'No due date'];
const AGING_LABEL: Record<string, string> = { 'Not yet due': 'Not yet due', '1–30 days': '1–30 days past due', '31–60 days': '31–60 days past due', '61–90 days': '61–90 days past due', '90+ days': 'More than 90 days past due', 'No due date': 'No due date' };

/**
 * Current unpaid balances by how far past due, from `finance_dashboard_summary.aging`. A snapshot
 * of today, not the selected month's activity, and never a time series.
 */
export function agingCharts(aging: FinanceSummary['aging']): ChartVariants {
  return currencies(aging).map(currency => {
    const bands = AGING_ORDER.filter(band => aging.some(row => row.currency === currency && row.band === band));
    return { key: currency, label: currency, data: {
      shape: 'categorical', format: { kind: 'money', currency }, period: 'Current outstanding receivables, as of today', categoryLabel: 'Age',
      categories: bands.map(band => ({ key: band, label: AGING_LABEL[band] ?? band, short: band })),
      series: [{ id: 'outstanding', label: 'Outstanding', points: bands.map(band => money(Number(aging.find(row => row.currency === currency && row.band === band)!.amount), currency)) }],
    } };
  });
}

export const PERFORMANCE_LIMIT = 8;
/**
 * Invoiced amount beside costs recorded against the same work, per customer, from
 * `listInvoicedAndIncurred` (customer grouping, selected month). The customers with the most
 * invoiced are shown; the rest stay on Reports. A cost the read model cannot define is Unknown,
 * never zero; zero recorded cost is shown as recorded. No margin is drawn.
 */
export function performanceCharts(groups: FinancialGroup[], periodLabel: string): ChartVariants {
  return currencies(groups).map(currency => {
    const rows = groups.filter(group => group.currency === currency).sort((a, b) => b.invoicedMinor - a.invoicedMinor).slice(0, PERFORMANCE_LIMIT);
    return { key: currency, label: currency, data: {
      shape: 'categorical', format: { kind: 'money', currency }, period: `${periodLabel} · top ${Math.min(PERFORMANCE_LIMIT, rows.length)} customers by invoiced`, categoryLabel: 'Customer',
      categories: rows.map((row, index) => ({ key: `${row.groupId ?? 'none'}-${index}`, label: row.label ?? 'Unattributed' })),
      series: [
        { id: 'invoiced', label: 'Invoiced', points: rows.map(row => money(row.invoicedMinor, currency)) },
        { id: 'costs', label: 'Costs recorded', points: rows.map(row => money(row.incurredMinor, currency)) },
      ],
    } };
  });
}

/**
 * Issued invoices split into overdue, unpaid but not overdue, and settled — three exact counts from
 * the invoice reads that already feed the Dashboard, so the parts add up to all issued invoices.
 * A current split, not a trend.
 */
export function invoiceStatusChart(counts: { issued: number; unpaid: number; overdue: number }, base: string): ChartVariants {
  const parts = [
    { key: 'overdue', label: 'Overdue', count: counts.overdue, href: `${base}/invoices?status=overdue` },
    { key: 'unpaid', label: 'Unpaid, not overdue', count: Math.max(0, counts.unpaid - counts.overdue), href: undefined },
    { key: 'settled', label: 'Settled', count: Math.max(0, counts.issued - counts.unpaid), href: `${base}/invoices?status=settled` },
  ];
  return [{ key: 'count', label: 'Count', data: {
    shape: 'composition', format: { kind: 'number', unit: 'invoices', precision: 0 }, period: `All ${counts.issued} issued invoices · current`, categoryLabel: 'Status',
    categories: parts.map(part => ({ key: part.key, label: part.label, href: part.href })),
    series: [{ id: 'invoices', label: 'Invoices', points: parts.map(part => ({ value: part.count, label: String(part.count) })) }],
  } }];
}
