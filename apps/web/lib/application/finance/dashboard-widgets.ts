import type { WidgetDefinition } from '@/lib/dashboard-layout';

/**
 * Finance Dashboard widgets, in the default reading order: Financial overview, Needs attention,
 * the payments trend and receivables aging (trends and collections), Financial activity, then
 * secondary reporting. The overview, attention and trend cannot be hidden, so the first screen stays
 * recognizable. Each widget names what a viewer needs to read it; a layout never overrides that.
 */
export const FINANCE_WIDGETS = [
  { id: 'overview', label: 'Financial overview', spans: [12], defaultSpan: 12, heights: ['standard'], defaultHeight: 'standard', hideable: false },
  { id: 'attention', label: 'Needs attention', spans: [4, 6, 8, 12], defaultSpan: 4, heights: ['standard'], defaultHeight: 'standard', hideable: false },
  { id: 'payments-trend', label: 'Payments received', spans: [4, 6, 8, 12], defaultSpan: 8, heights: ['compact', 'standard', 'tall'], defaultHeight: 'standard', presentations: ['line', 'bar', 'table'], hideable: false, fullOnTablet: true },
  { id: 'aging', label: 'Receivables aging', spans: [4, 6, 8, 12], defaultSpan: 6, heights: ['compact', 'standard', 'tall'], defaultHeight: 'standard', presentations: ['horizontal-bar', 'table'], hideable: true },
  { id: 'activity', label: 'Financial activity', spans: [4, 6, 12], defaultSpan: 6, heights: ['standard'], defaultHeight: 'standard', densities: ['comfortable', 'compact'], hideable: true },
  { id: 'performance', label: 'Invoiced and recorded costs', spans: [6, 8, 12], defaultSpan: 6, heights: ['compact', 'standard', 'tall'], defaultHeight: 'standard', presentations: ['horizontal-bar', 'bar', 'table'], hideable: true, fullOnTablet: true },
  { id: 'invoice-status', label: 'Invoices by status', spans: [4, 6, 12], defaultSpan: 6, heights: ['compact', 'standard'], defaultHeight: 'compact', presentations: ['stacked-bar', 'donut', 'table'], hideable: true },
] as const satisfies readonly WidgetDefinition[];

export type FinanceWidgetId = (typeof FINANCE_WIDGETS)[number]['id'];

/**
 * Which widgets this viewer may read. Amount charts follow the existing rule that aggregate
 * financial values need `report.read`; counts and recorded activity follow the Dashboard's
 * existing visibility. Billing off shows no widget at all.
 */
export function readableFinanceWidgets(input: { billingEnabled: boolean; capabilities: readonly string[] }): Set<FinanceWidgetId> {
  if (!input.billingEnabled) return new Set();
  const reports = input.capabilities.includes('report.read');
  return new Set<FinanceWidgetId>(['overview', 'attention', 'activity', 'invoice-status', ...(reports ? ['payments-trend', 'aging', 'performance'] as const : [])]);
}
