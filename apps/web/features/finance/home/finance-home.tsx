import Link from 'next/link';
import { AlertTriangle, Banknote, CircleCheck, ClipboardList, FileText, Tag, Undo2 } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { MetricTile, OperationalPanel, PanelState } from '@/components/operational/primitives';
import { cx } from '@/components/class-names';
import { QuoteDialog } from '../transactions/quote-dialog';
import { invoiceHref, workHref } from '../collections/finance-tables';
import { AttentionCategories, type AttentionCategory } from '@/components/operational/attention-categories';
import type { FinanceOperating } from '@/lib/application/finance/operating';
import { DUE_SOON_DAYS } from '@/lib/application/finance/operating';
import type { CurrencyAmount } from '@/lib/domain/billing/finance-reads';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { DashboardEditingProvider, DashboardLayoutGrid, type DashboardWidgetContent } from '@/components/dashboard/dashboard-layout';
import { FinanceHeaderActions } from './finance-header-actions';
import { FinancePeriod } from './finance-period';
import { FINANCE_WIDGETS, readableFinanceWidgets } from '@/lib/application/finance/dashboard-widgets';
import { agingCharts, invoiceStatusChart, paymentsTrendCharts, performanceCharts } from '@/lib/application/finance/dashboard-charts';
import type { StoredDashboardLayout } from '@/lib/domain/preferences/dashboard-layouts';
import { resetFinanceDashboardLayout, saveFinanceDashboardLayout } from '@/app/organizations/[organizationId]/finance/dashboard-actions';

/** Each currency on its own line; amounts in different currencies are never added together. */
function Amounts({ values, empty }: { values: CurrencyAmount[]; empty: string }) {
  return values.length ? <>{values.map(v => <span key={v.currency} className="block tabular-nums">{formatMoney(Number(v.amount), v.currency)}</span>)}</> : <span className="text-sm font-normal leading-5 text-muted">{empty}</span>;
}

/**
 * Finance Dashboard, in reading order: Financial overview (period-aware for reporting members),
 * Needs attention (only categories with records, otherwise one all-clear line), Financial activity
 * from recorded events, then reporting widgets for `report.read`. A business with nothing recorded
 * keeps the same Dashboard: the attention slot becomes a compact Getting started panel offering the
 * one next step, and reporting charts appear once there is something to chart. Entitlement decides
 * whether billing applies at all; capabilities decide which actions and amounts appear.
 */
export function FinanceHome({ organizationId, timezone, today, data, capabilities, layout }: { organizationId: string; timezone: string; today: string; data: FinanceOperating; capabilities: readonly string[]; layout: StoredDashboardLayout }) {
  const base = `/organizations/${organizationId}`, finance = `${base}/finance`;
  const { summary, open, overdue, dueSoon, quotes, period } = data;
  const has = (cap: string) => capabilities.includes(cap);
  const may = (cap: 'invoice.issue' | 'work_item.price' | 'payment.record') => data.billingEnabled && has(cap);
  const reports = has('report.read') && summary !== null;
  const mayManageCatalog = has('price.manage');
  // Card payments are configured in Organization Settings → Customer payments; anyone else reads General, which says who can.
  const gettingPaidHref = `${base}/settings/${has('organization.manage') ? 'payments' : 'general'}`;
  const shortDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(iso));
  const localDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const monthLabel = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${period.from}T12:00:00Z`));

  if (!data.billingEnabled) return <WorkspaceHome title="Finance">
    <OperationalPanel title="Billing is off"><PanelState kind="not-configured" action={has('feature.manage') ? <ButtonLink tone="secondary" href={`${base}/settings/features`}>Manage features</ButtonLink> : undefined}>This business does not price, quote or invoice in GildOps. Records made while billing was on stay as they were.</PanelState></OperationalPanel>
  </WorkspaceHome>;

  const invoiceRow = (row: (typeof overdue.rows)[number], when: string) => ({ id: row.id, href: invoiceHref(organizationId, row), title: `Invoice #${row.number} · ${row.billedTo}`, detail: when, value: row.outstandingMinor === null ? '—' : formatMoney(Math.max(row.outstandingMinor, 0), row.currency), tone: row.overdue ? 'danger' as const : undefined });
  const categories: AttentionCategory[] = [
    { key: 'overdue', label: 'Overdue', count: overdue.total, href: `${finance}/invoices?status=overdue&sort=due`, rows: overdue.rows.map(row => invoiceRow(row, `Was due ${row.dueAt ? shortDate(row.dueAt) : ''}`)) },
    { key: 'due-soon', label: 'Due soon', count: dueSoon.total, href: `${finance}/invoices?status=due-soon&sort=due`, rows: dueSoon.rows.map(row => invoiceRow(row, row.dueAt && localDay(row.dueAt) === today ? 'Due today' : `Due ${row.dueAt ? shortDate(row.dueAt) : ''}`)) },
    ...(may('invoice.issue') || has('report.read') ? [{ key: 'to-invoice', label: 'Ready to invoice', count: quotes.total, href: `${finance}/quotes?status=not-invoiced`, rows: quotes.rows.map(row => ({ id: row.workItemId, href: workHref(organizationId, row.workItemId), title: row.title, detail: `${row.customer?.name ?? 'No contact'} · ${row.lineCount} priced ${row.lineCount === 1 ? 'line' : 'lines'}`, value: row.quoted ? formatMoney(row.quoted.totalMinor, row.quoted.currency) : '—' })) }] : []),
    ...(data.cardCollection === 'not-connected' || data.cardCollection === 'unavailable' ? [{ key: 'card', label: 'Card payments', count: 1, href: gettingPaidHref, rows: [{ id: 'card', href: gettingPaidHref, title: data.cardCollection === 'unavailable' ? 'Card payments are on, but no payment processor is available' : 'Card payments are on, but no payment account is connected', detail: 'Manual payment recording still works.', value: '' }] }] : []),
  ].filter(category => category.count > 0);

  // The reporting period governs payments received and the period charts; receivables stay current.
  const periodControl = reports ? <FinancePeriod action={finance} month={period.month} /> : null;
  // Before anything is recorded the reporting charts have nothing to show, so they are not drawn at all.
  // Activity with nothing in it would only repeat the Getting started panel, so it waits for the first event.
  const readable = new Set([...readableFinanceWidgets({ billingEnabled: data.billingEnabled, capabilities })].filter(id => data.started || !['payments-trend', 'aging', 'performance', 'invoice-status', ...(data.activity.length ? [] : ['activity'])].includes(id)));
  const periodLabel = monthLabel;
  // Before anything is recorded every tile reads None; one line says why rather than four different sentences.
  const first = !data.started;
  const none = (text: string) => first ? 'None' : text;
  const overview = <div className="@container min-w-0">
    <h2 className="sr-only">Financial overview</h2>
    <div className="grid min-w-0 gap-3 @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
      {reports ? <MetricTile label="Payments received" icon={Banknote} value={<Amounts values={summary.received} empty={none('None this month')} />} detail={first ? undefined : `${monthLabel} · net of corrections`} href={`${finance}/payments?from=${period.from}&to=${period.to}`} /> : null}
      <MetricTile label="Outstanding" icon={FileText} value={reports ? <Amounts values={summary.outstanding} empty={none('Nothing outstanding')} /> : open.total} detail={first ? undefined : `${open.total} unpaid ${open.total === 1 ? 'invoice' : 'invoices'}`} href={`${finance}/invoices?status=outstanding`} />
      <MetricTile label="Overdue" icon={AlertTriangle} value={reports ? <Amounts values={data.overdueAmounts ?? []} empty={none('Nothing overdue')} /> : overdue.total} detail={first ? undefined : `${overdue.total} past ${overdue.total === 1 ? 'its' : 'their'} due date`} href={`${finance}/invoices?status=overdue`} emphasis={overdue.total > 0 ? 'danger' : undefined} />
      <MetricTile label="Quoted, not invoiced" icon={ClipboardList} value={reports ? <Amounts values={summary.quoted} empty={none('Nothing waiting')} /> : quotes.total} detail={first ? undefined : `${quotes.total} priced Work ${quotes.total === 1 ? 'item' : 'items'}`} href={`${finance}/quotes?status=not-invoiced`} />
    </div>
    {first ? <p className="mt-2 text-xs text-muted">No invoices, quotes or payments are recorded yet.</p> : null}
    {!reports ? <p className="mt-2 text-xs text-muted">Amounts are shown to people with reporting access.</p> : null}
  </div>;
  const attention = !data.started ? <GettingStarted organizationId={organizationId} priced={data.priceBookCount > 0} mayManageCatalog={mayManageCatalog} mayQuote={may('work_item.price')} mayCreateWork={has('work_item.create')} />
    : categories.length ? <OperationalPanel className="h-full min-w-0" title="Needs attention"><AttentionCategories categories={categories} /></OperationalPanel>
    : <p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"><CircleCheck aria-hidden className="size-4 shrink-0 text-muted" /><span><span className="font-medium">Needs attention:</span> nothing overdue or due in the next {DUE_SOON_DAYS} days, and no priced Work waiting for an invoice.</span></p>;
  const reportsLink = <p className="mt-2 text-right text-xs"><Link className="text-accent-text underline-offset-4 hover:underline" href={`${finance}/reports`}>Open financial reports</Link></p>;
  // Built only for widgets this viewer may read; a hidden-by-permission chart is never computed.
  const widgets: Record<string, DashboardWidgetContent> = {
    overview: { kind: 'node', node: overview },
    attention: { kind: 'node', node: attention },
    activity: { kind: 'node', node: <FinanceActivity organizationId={organizationId} activity={data.activity} shortDate={shortDate} />, densities: { compact: <FinanceActivity organizationId={organizationId} activity={data.activity} shortDate={shortDate} compact /> } },
    'invoice-status': { kind: 'chart', title: 'Invoices by status', variants: invoiceStatusChart({ issued: data.issuedCount, unpaid: open.total, overdue: overdue.total }, finance) },
    ...(reports && readable.has('payments-trend') ? {
      'payments-trend': { kind: 'chart' as const, title: 'Payments received', variants: paymentsTrendCharts(summary.trend, periodLabel), state: summary.trend.length ? undefined : { status: 'empty' as const, message: `No payments recorded in ${monthLabel}.` } },
      aging: { kind: 'chart' as const, title: 'Receivables aging', variants: agingCharts(summary.aging), state: summary.aging.length ? undefined : { status: 'empty' as const, message: 'Nothing is outstanding.' } },
      performance: { kind: 'chart' as const, title: 'Invoiced and recorded costs', variants: performanceCharts(data.financialGroups ?? [], periodLabel), state: data.financialGroups?.length ? undefined : { status: 'empty' as const, message: `Nothing invoiced in ${monthLabel}.` },
        footer: <><p className="mt-2 text-xs text-muted">Costs are those recorded against the same work; a customer with no recorded cost shows zero recorded, which is not a measured margin.</p>{reportsLink}</> },
    } : {}),
  };
  return <DashboardEditingProvider available>
    <WorkspaceHome title="Finance" actions={<FinanceHeaderActions organizationId={organizationId} today={today} period={periodControl} firstRun={!data.started}
      mayQuote={may('work_item.price')} mayRecord={may('payment.record') && data.started} mayInvoice={may('invoice.issue') && data.started} mayCreateWork={has('work_item.create')} mayManageCatalog={mayManageCatalog} />}>
      <DashboardLayoutGrid label="Finance dashboard" registry={FINANCE_WIDGETS} saved={layout} readable={[...readable]} widgets={widgets}
        onSave={saveFinanceDashboardLayout.bind(null, organizationId)} onReset={resetFinanceDashboardLayout.bind(null, organizationId)} />
    </WorkspaceHome>
  </DashboardEditingProvider>;
}

/**
 * The first-run panel in the attention slot: one sentence and the one next step for this business,
 * not a fixed checklist. Pricing is set up in the price book; quoting starts from a Work item and
 * snapshots its prices; neither creates the other.
 */
function GettingStarted({ organizationId, priced, mayManageCatalog, mayQuote, mayCreateWork }: { organizationId: string; priced: boolean; mayManageCatalog: boolean; mayQuote: boolean; mayCreateWork: boolean }) {
  const finance = `/organizations/${organizationId}/finance`;
  const [text, action] = !priced
    ? [mayManageCatalog ? 'Nothing is priced yet. Add price items for what this business charges, then quote Work from them.' : 'Nothing is priced yet. Someone who manages pricing adds price items before Work can be quoted.',
      mayManageCatalog ? <ButtonLink size="small" tone="primary" href={`${finance}/catalog`}><Tag aria-hidden className="size-4" />Set up pricing</ButtonLink> : null]
    : ['Prices are ready. Choose a Work item and add priced lines to create its quote; invoices and payments follow from there.',
      mayQuote ? <QuoteDialog organizationId={organizationId} label="Price Work" size="small" tone="primary" mayCreateWork={mayCreateWork} mayManageCatalog={mayManageCatalog} /> : <ButtonLink size="small" tone="secondary" href={`${finance}/catalog`}>View price book</ButtonLink>];
  return <OperationalPanel className="h-full min-w-0" title="Getting started" density="compact">
    <div className="flex flex-col items-start gap-3 text-sm"><p>{text}</p>{action}</div>
  </OperationalPanel>;
}

const EVENT_LABEL: Record<string, string> = { 'invoice.issued': 'Invoice issued', 'payment.recorded': 'Payment recorded', 'work_item.line_added': 'Quote line added', 'work_item.line_removed': 'Quote line removed', 'price_book_item.created': 'Price item added', 'price_book_item.updated': 'Price changed' };

/** Recorded Finance events only, each linked to the record it is about; nothing here is inferred. */
function FinanceActivity({ organizationId, activity, shortDate, compact = false }: { organizationId: string; activity: FinanceOperating['activity']; shortDate: (iso: string) => string; compact?: boolean }) {
  const base = `/organizations/${organizationId}`;
  return <OperationalPanel density="compact" title="Financial activity" className="h-full min-w-0">{activity.length ? <ul className="divide-y divide-border">{activity.map(event => {
    const p = event.payload as Record<string, unknown>;
    const amount = typeof p.amount_minor === 'number' && typeof p.currency === 'string' ? p.amount_minor : null;
    const correction = event.action === 'payment.recorded' && amount !== null && amount < 0;
    const label = correction ? 'Correction recorded' : event.action === 'invoice.issued' ? `Invoice #${p.number ?? ''} issued` : EVENT_LABEL[event.action] ?? 'Financial change';
    const detail = typeof p.description === 'string' ? p.description : typeof p.name === 'string' ? p.name : amount !== null ? formatMoney(amount, p.currency as string) : event.action === 'invoice.issued' ? `Open invoice${typeof p.currency === 'string' ? ` · ${p.currency}` : ''}` : 'Open record';
    const href = event.entity_type === 'work_item' ? workHref(organizationId, event.entity_id) : event.entity_type === 'invoice' ? invoiceHref(organizationId, { id: event.entity_id, workItemId: null }) : `${base}/finance/catalog`;
    const Icon = correction ? Undo2 : event.action === 'payment.recorded' ? Banknote : event.action.startsWith('price_book') ? Tag : FileText;
    return <li key={event.id}><Link href={href} className={cx('flex items-start gap-2.5 text-sm hover:bg-hover', compact ? 'py-1.5' : 'py-2.5')}>
      <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', correction ? 'text-danger' : 'text-muted')} />
      <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span><span className={cx('block break-words text-xs', correction ? 'text-danger' : 'text-muted')}>{detail}</span></span>
      <time dateTime={event.occurred_at} className="shrink-0 text-xs text-muted">{shortDate(event.occurred_at)}</time>
    </Link></li>;
  })}</ul> : <PanelState>No financial activity recorded yet.</PanelState>}</OperationalPanel>;
}
