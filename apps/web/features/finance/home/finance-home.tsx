import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Banknote, CheckCircle2, CircleCheck, ClipboardList, FileText, Tag, Undo2 } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { MetricTile, OperationalPanel, PanelState } from '@/components/operational/primitives';
import { cx } from '@/components/class-names';
import { InvoiceDialog } from '../transactions/invoice-dialog';
import { PaymentDialog } from '../transactions/payment-dialog';
import { QuoteDialog } from '../transactions/quote-dialog';
import { workHref } from '../collections/finance-tables';
import { FinanceAttention, type AttentionCategory } from './finance-attention';
import type { FinanceOperating } from '@/lib/application/finance/operating';
import { DUE_SOON_DAYS } from '@/lib/application/finance/operating';
import type { CurrencyAmount } from '@/lib/domain/billing/finance-reads';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { DashboardEditingProvider, DashboardLayoutGrid, type DashboardWidgetContent } from '@/components/dashboard/dashboard-layout';
import type { ConfigureItem } from '@/lib/navigation';
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
 * from recorded events, then Collections & receivables for `report.read`. Before the first priced
 * Work, invoice or payment it offers a starting path instead of zero-valued figures. Entitlement
 * decides whether billing applies at all; capabilities decide which actions and amounts appear.
 */
export function FinanceHome({ organizationId, timezone, today, data, capabilities, configure, configureItems = [], layout }: { organizationId: string; timezone: string; today: string; data: FinanceOperating; capabilities: readonly string[]; configure?: ReactNode; configureItems?: ConfigureItem[]; layout: StoredDashboardLayout }) {
  const base = `/organizations/${organizationId}`, finance = `${base}/finance`;
  const { summary, open, overdue, dueSoon, quotes, period } = data;
  const has = (cap: string) => capabilities.includes(cap);
  const may = (cap: 'invoice.issue' | 'work_item.price' | 'payment.record') => data.billingEnabled && has(cap);
  const reports = has('report.read') && summary !== null;
  const mayManageCatalog = has('price.manage');
  const configureHref = `${finance}/configuration/pricing#getting-paid`;
  const shortDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(iso));
  const localDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const monthLabel = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${period.from}T12:00:00Z`));

  // One visually primary action, chosen by what this member can do: issuing is the usual next step,
  // then recording money, then pricing. A business with nothing priced starts at its catalog.
  const startAtCatalog = data.billingEnabled && data.priceBookCount === 0;
  const primary = startAtCatalog ? 'catalog' : may('invoice.issue') ? 'invoice' : may('payment.record') ? 'payment' : may('work_item.price') ? 'quote' : null;
  const actions = <>
    {configure}
    {!startAtCatalog && may('work_item.price') ? <QuoteDialog organizationId={organizationId} tone={primary === 'quote' ? 'primary' : 'secondary'} mayCreateWork={has('work_item.create')} mayManageCatalog={mayManageCatalog} /> : null}
    {!startAtCatalog && data.started && may('payment.record') ? <PaymentDialog organizationId={organizationId} today={today} tone={primary === 'payment' ? 'primary' : 'secondary'} /> : null}
    {!startAtCatalog && data.started && may('invoice.issue') ? <InvoiceDialog organizationId={organizationId} today={today} tone="primary" /> : null}
    {startAtCatalog && mayManageCatalog ? <ButtonLink tone="primary" href={`${finance}/catalog`}><Tag aria-hidden className="size-4" />Add services</ButtonLink> : null}
  </>;

  if (!data.billingEnabled) return <WorkspaceHome title="Finance" actions={configure}>
    <OperationalPanel title="Billing is off"><PanelState kind="not-configured" action={has('feature.manage') ? <ButtonLink tone="secondary" href={`${base}/settings/features`}>Manage features</ButtonLink> : undefined}>This business does not price, quote or invoice in GildOps. Records made while billing was on stay as they were.</PanelState></OperationalPanel>
  </WorkspaceHome>;

  if (!data.started) return <WorkspaceHome title="Finance" actions={actions}>
    <StartingPath organizationId={organizationId} data={data} mayManageCatalog={mayManageCatalog} mayQuote={may('work_item.price')} mayCreateWork={has('work_item.create')} configureHref={configureHref} />
  </WorkspaceHome>;

  const invoiceRow = (row: (typeof overdue.rows)[number], when: string) => ({ id: row.id, href: workHref(organizationId, row.workItemId), title: `Invoice #${row.number} · ${row.billedTo}`, detail: when, amount: row.outstandingMinor === null ? '—' : formatMoney(Math.max(row.outstandingMinor, 0), row.currency), tone: row.overdue ? 'danger' as const : undefined });
  const categories: AttentionCategory[] = [
    { key: 'overdue', label: 'Overdue', count: overdue.total, href: `${finance}/invoices?status=overdue&sort=due`, rows: overdue.rows.map(row => invoiceRow(row, `Was due ${row.dueAt ? shortDate(row.dueAt) : ''}`)) },
    { key: 'due-soon', label: 'Due soon', count: dueSoon.total, href: `${finance}/invoices?status=due-soon&sort=due`, rows: dueSoon.rows.map(row => invoiceRow(row, row.dueAt && localDay(row.dueAt) === today ? 'Due today' : `Due ${row.dueAt ? shortDate(row.dueAt) : ''}`)) },
    ...(may('invoice.issue') || has('report.read') ? [{ key: 'to-invoice', label: 'Ready to invoice', count: quotes.total, href: `${finance}/quotes?status=not-invoiced`, rows: quotes.rows.map(row => ({ id: row.workItemId, href: workHref(organizationId, row.workItemId), title: row.title, detail: `${row.customer?.name ?? 'No contact'} · ${row.lineCount} priced ${row.lineCount === 1 ? 'line' : 'lines'}`, amount: row.quoted ? formatMoney(row.quoted.totalMinor, row.quoted.currency) : '—' })) }] : []),
    ...(data.cardCollection === 'not-connected' || data.cardCollection === 'unavailable' ? [{ key: 'card', label: 'Card payments', count: 1, href: configureHref, rows: [{ id: 'card', href: configureHref, title: data.cardCollection === 'unavailable' ? 'Card payments are on, but no payment processor is available' : 'Card payments are on, but no payment account is connected', detail: 'Manual payment recording still works.', amount: '' }] }] : []),
  ].filter(category => category.count > 0);

  // The reporting period governs payments received and the period charts; receivables stay current.
  const periodControl = reports ? <FinancePeriod action={finance} month={period.month} /> : null;
  const readable = readableFinanceWidgets({ billingEnabled: data.billingEnabled, capabilities });
  const periodLabel = monthLabel;
  const overview = <div className="@container min-w-0">
    <h2 className="sr-only">Financial overview</h2>
    <div className="grid min-w-0 gap-3 @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
      {reports ? <MetricTile label="Payments received" icon={Banknote} value={<Amounts values={summary.received} empty="None this month" />} detail={`${monthLabel} · net of corrections`} href={`${finance}/payments?from=${period.from}&to=${period.to}`} /> : null}
      <MetricTile label="Outstanding" icon={FileText} value={reports ? <Amounts values={summary.outstanding} empty="Nothing outstanding" /> : open.total} detail={`${open.total} unpaid ${open.total === 1 ? 'invoice' : 'invoices'}`} href={`${finance}/invoices?status=outstanding`} />
      <MetricTile label="Overdue" icon={AlertTriangle} value={reports ? <Amounts values={data.overdueAmounts ?? []} empty="Nothing overdue" /> : overdue.total} detail={`${overdue.total} past ${overdue.total === 1 ? 'its' : 'their'} due date`} href={`${finance}/invoices?status=overdue`} emphasis={overdue.total > 0 ? 'danger' : undefined} />
      <MetricTile label="Quoted, not invoiced" icon={ClipboardList} value={reports ? <Amounts values={summary.quoted} empty="Nothing waiting" /> : quotes.total} detail={`${quotes.total} priced Work ${quotes.total === 1 ? 'item' : 'items'}`} href={`${finance}/quotes?status=not-invoiced`} />
    </div>
    {!reports ? <p className="mt-2 text-xs text-muted">Amounts are shown to people with reporting access.</p> : null}
  </div>;
  const attention = categories.length ? <OperationalPanel className="h-full min-w-0" title="Needs attention"><FinanceAttention categories={categories} /></OperationalPanel>
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
    <WorkspaceHome title="Finance" actions={<FinanceHeaderActions organizationId={organizationId} today={today} period={periodControl} configure={configure} configureItems={configureItems}
      mayQuote={may('work_item.price')} mayRecord={may('payment.record')} mayInvoice={may('invoice.issue')} mayCreateWork={has('work_item.create')} mayManageCatalog={mayManageCatalog} />}>
      <DashboardLayoutGrid label="Finance dashboard" registry={FINANCE_WIDGETS} saved={layout} readable={[...readable]} widgets={widgets}
        onSave={saveFinanceDashboardLayout.bind(null, organizationId)} onReset={resetFinanceDashboardLayout.bind(null, organizationId)} />
    </WorkspaceHome>
  </DashboardEditingProvider>;
}

function StartingPath({ organizationId, data, mayManageCatalog, mayQuote, mayCreateWork, configureHref }: { organizationId: string; data: FinanceOperating; mayManageCatalog: boolean; mayQuote: boolean; mayCreateWork: boolean; configureHref: string }) {
  const finance = `/organizations/${organizationId}/finance`;
  const priced = data.priceBookCount > 0;
  const steps: { title: string; detail: string; done?: boolean; action?: ReactNode }[] = [
    { title: 'Add the services you charge for', detail: priced ? `${data.priceBookCount} ${data.priceBookCount === 1 ? 'service is' : 'services are'} in your catalog.` : 'Each has a name, a unit and a price. Quotes are built from them.', done: priced, action: <ButtonLink size="small" tone={priced ? 'text' : 'secondary'} href={`${finance}/catalog`}>{priced ? 'Open catalog' : mayManageCatalog ? 'Add services' : 'View catalog'}</ButtonLink> },
    { title: 'Price a Work item', detail: 'A quote is a Work item with priced lines from your catalog.', action: priced && mayQuote ? <QuoteDialog organizationId={organizationId} label="Price Work" size="small" mayCreateWork={mayCreateWork} mayManageCatalog={mayManageCatalog} /> : undefined },
    { title: 'Issue the invoice', detail: 'Review the priced Work, set its dates and confirm. Issued invoices are not edited.' },
    { title: 'Record payments as they arrive', detail: data.cardCollection === 'connected' ? 'Card payments are connected; payments can also be recorded by hand.' : 'Payments are recorded by hand against each invoice.', action: data.cardCollection === 'not-connected' || data.cardCollection === 'unavailable' ? <ButtonLink size="small" tone="text" href={configureHref}>Set up card payments</ButtonLink> : undefined },
  ];
  return <OperationalPanel title="Get started with Finance">
    <ol className="flex flex-col divide-y divide-border">
      {steps.map((step, index) => <li key={step.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <span aria-hidden className={cx('flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold', step.done ? 'border-success/30 bg-success/10 text-success' : 'border-border text-muted')}>{step.done ? <CheckCircle2 className="size-4" /> : index + 1}</span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{step.title}{step.done ? <span className="sr-only"> (done)</span> : null}</span><span className="block text-xs text-muted">{step.detail}</span></span>
        {step.action ? <span className="shrink-0">{step.action}</span> : null}
      </li>)}
    </ol>
  </OperationalPanel>;
}

const EVENT_LABEL: Record<string, string> = { 'invoice.issued': 'Invoice issued', 'payment.recorded': 'Payment recorded', 'work_item.line_added': 'Quote line added', 'work_item.line_removed': 'Quote line removed', 'price_book_item.created': 'Service added to catalog', 'price_book_item.updated': 'Catalog price changed' };

/** Recorded Finance events only, each linked to the record it is about; nothing here is inferred. */
function FinanceActivity({ organizationId, activity, shortDate, compact = false }: { organizationId: string; activity: FinanceOperating['activity']; shortDate: (iso: string) => string; compact?: boolean }) {
  const base = `/organizations/${organizationId}`;
  return <OperationalPanel density="compact" title="Financial activity" className="h-full min-w-0">{activity.length ? <ul className="divide-y divide-border">{activity.map(event => {
    const p = event.payload as Record<string, unknown>;
    const amount = typeof p.amount_minor === 'number' && typeof p.currency === 'string' ? p.amount_minor : null;
    const correction = event.action === 'payment.recorded' && amount !== null && amount < 0;
    const label = correction ? 'Correction recorded' : event.action === 'invoice.issued' ? `Invoice #${p.number ?? ''} issued` : EVENT_LABEL[event.action] ?? 'Financial change';
    const detail = typeof p.description === 'string' ? p.description : typeof p.name === 'string' ? p.name : amount !== null ? formatMoney(amount, p.currency as string) : event.action === 'invoice.issued' ? `Open invoice${typeof p.currency === 'string' ? ` · ${p.currency}` : ''}` : 'Open record';
    const href = event.entity_type === 'work_item' ? workHref(organizationId, event.entity_id) : `${base}/finance/catalog`;
    const Icon = correction ? Undo2 : event.action === 'payment.recorded' ? Banknote : event.action.startsWith('price_book') ? Tag : FileText;
    return <li key={event.id}><Link href={href} className={cx('flex items-start gap-2.5 text-sm hover:bg-hover', compact ? 'py-1.5' : 'py-2.5')}>
      <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', correction ? 'text-danger' : 'text-muted')} />
      <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span><span className={cx('block break-words text-xs', correction ? 'text-danger' : 'text-muted')}>{detail}</span></span>
      <time dateTime={event.occurred_at} className="shrink-0 text-xs text-muted">{shortDate(event.occurred_at)}</time>
    </Link></li>;
  })}</ul> : <PanelState>No financial activity recorded yet.</PanelState>}</OperationalPanel>;
}
