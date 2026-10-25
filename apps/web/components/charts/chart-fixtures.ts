import type { ChartData, ChartPoint } from './chart-model';

/**
 * Synthetic chart data for the development gallery (`/dev/charts`) and the focused chart tests
 * only. Never imported by an application page: live charts receive authorized data from the server.
 */
const cad = (minor: number | null): ChartPoint => ({ value: minor, label: minor === null ? 'Unknown' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'CAD' }).format(minor / 100) });
const usd = (minor: number): ChartPoint => ({ value: minor, label: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'USD' }).format(minor / 100) });
const days = (list: string[]) => list.map(day => ({ key: day, label: new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`)), at: day }));

export const CHART_FIXTURES: Record<string, { title: string; data: ChartData; note: string }> = {
  paymentsWithCorrections: { title: 'Payments received', note: 'Positive receipts and a negative correction; sparse dates keep real spacing.', data: {
    shape: 'time-series', format: { kind: 'money', currency: 'CAD' }, period: 'October 2026', categoryLabel: 'Day',
    categories: days(['2026-10-01', '2026-10-02', '2026-10-09', '2026-10-20', '2026-10-24']),
    series: [{ id: 'cad', label: 'Received', points: [cad(42050), cad(0), cad(-2500), cad(120000), cad(22950)] }],
  } },
  paymentsUsd: { title: 'Payments received', note: 'The USD variant of the same period: currencies are separate datasets, never one axis.', data: {
    shape: 'time-series', format: { kind: 'money', currency: 'USD' }, period: 'October 2026', categoryLabel: 'Day',
    categories: days(['2026-10-03', '2026-10-27']), series: [{ id: 'usd', label: 'Received', points: [usd(36000), usd(18000)] }],
  } },
  singlePoint: { title: 'Payments received', note: 'One recorded day.', data: {
    shape: 'time-series', format: { kind: 'money', currency: 'CAD' }, period: 'November 2026', categoryLabel: 'Day',
    categories: days(['2026-11-04']), series: [{ id: 'cad', label: 'Received', points: [cad(9550)] }],
  } },
  empty: { title: 'Payments received', note: 'No payments: an empty state, never sample values.', data: {
    shape: 'time-series', format: { kind: 'money', currency: 'CAD' }, period: 'December 2025', categoryLabel: 'Day', categories: [], series: [{ id: 'cad', label: 'Received', points: [] }],
  } },
  agingLongLabels: { title: 'Receivables aging', note: 'Long category labels, a zero band and a very large balance.', data: {
    shape: 'categorical', format: { kind: 'money', currency: 'CAD' }, period: 'Current, as of today', categoryLabel: 'Age',
    categories: [
      { key: 'not-due', label: 'Not yet due (current receivables, by due date)' }, { key: '1-30', label: '1–30 days past due' },
      { key: '31-60', label: '31–60 days past due' }, { key: '90', label: 'More than 90 days past due, still outstanding' },
    ],
    series: [{ id: 'cad', label: 'Outstanding', points: [cad(153_600_000_00), cad(82950), cad(0), cad(4_412_005)] }],
  } },
  financialsUnknown: { title: 'Invoiced and recorded costs', note: 'Two series with an unknown cost shown as unknown, never zero.', data: {
    shape: 'categorical', format: { kind: 'money', currency: 'CAD' }, period: 'October 2026', categoryLabel: 'Customer',
    categories: [{ key: 'a', label: 'Vertex HVAC' }, { key: 'b', label: 'Maple Dental' }, { key: 'c', label: 'Lumière Studio' }],
    series: [{ id: 'invoiced', label: 'Invoiced', points: [cad(56150), cad(44300), cad(22950)] }, { id: 'costs', label: 'Costs recorded', points: [cad(21000), cad(null), cad(9000)] }],
  } },
  invoiceStatus: { title: 'Invoices by status', note: 'Parts of one whole (all issued invoices), so a donut is offered.', data: {
    shape: 'composition', format: { kind: 'number', unit: 'invoices', precision: 0 }, period: 'Current', categoryLabel: 'Status',
    categories: [{ key: 'overdue', label: 'Overdue' }, { key: 'outstanding', label: 'Outstanding, not overdue' }, { key: 'settled', label: 'Settled' }],
    series: [{ id: 'count', label: 'Invoices', points: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 1, label: '1' }] }],
  } },
};
