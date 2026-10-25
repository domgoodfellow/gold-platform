import type { ReactNode } from 'react';
import Link from 'next/link';
import { Banknote, CheckCircle2, CircleCheck, FileText, Tag, Undo2 } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
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
export function FinanceHome({ organizationId, timezone, today, data, capabilities, configure }: { organizationId: string; timezone: string; today: string; data: FinanceOperating; capabilities: readonly string[]; configure?: ReactNode }) {
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

  return <WorkspaceHome title="Finance" actions={actions}>
    <section aria-labelledby="finance-overview" className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="finance-overview" className="text-sm font-semibold">Financial overview</h2>
        {reports ? <form method="get" action={finance} className="flex items-center gap-1"><TextInput aria-label="Reporting month" name="month" type="month" defaultValue={period.month} size="small" className="w-40" /><Button type="submit" tone="text" size="small">Apply</Button></form> : null}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {reports ? <MetricTile label="Payments received" icon={Banknote} value={<Amounts values={summary.received} empty="None this month" />} detail={`${monthLabel} · net of corrections`} href={`${finance}/payments?from=${period.from}&to=${period.to}`} /> : null}
        <MetricTile label="Outstanding" icon={FileText} value={reports ? <Amounts values={summary.outstanding} empty="Nothing outstanding" /> : open.total} detail={`${open.total} unpaid ${open.total === 1 ? 'invoice' : 'invoices'}`} href={`${finance}/invoices?status=outstanding`} />
        <MetricTile label="Overdue" value={reports ? <Amounts values={data.overdueAmounts ?? []} empty="Nothing overdue" /> : overdue.total} detail={`${overdue.total} past ${overdue.total === 1 ? 'its' : 'their'} due date`} href={`${finance}/invoices?status=overdue`} emphasis={overdue.total > 0 ? 'danger' : undefined} />
        <MetricTile label="Quoted, not invoiced" value={reports ? <Amounts values={summary.quoted} empty="Nothing waiting" /> : quotes.total} detail={`${quotes.total} priced Work ${quotes.total === 1 ? 'item' : 'items'}`} href={`${finance}/quotes?status=not-invoiced`} />
      </div>
      {!reports ? <p className="mt-2 text-xs text-muted">Amounts are shown to people with reporting access.</p> : null}
    </section>
    <div className="mb-6 grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      {categories.length ? <OperationalPanel className="min-w-0" title="Needs attention"><FinanceAttention categories={categories} /></OperationalPanel>
        : <p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"><CircleCheck aria-hidden className="size-4 text-muted" /><span><span className="font-medium">Needs attention:</span> nothing overdue or due in the next {DUE_SOON_DAYS} days, and no priced Work waiting for an invoice.</span></p>}
      <FinanceActivity organizationId={organizationId} activity={data.activity} shortDate={shortDate} />
    </div>
    {reports ? <Collections finance={finance} summary={summary} financials={data.financials} monthLabel={monthLabel} /> : null}
  </WorkspaceHome>;
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
function FinanceActivity({ organizationId, activity, shortDate }: { organizationId: string; activity: FinanceOperating['activity']; shortDate: (iso: string) => string }) {
  const base = `/organizations/${organizationId}`;
  return <OperationalPanel density="compact" title="Financial activity" className="min-w-0">{activity.length ? <ul className="divide-y divide-border">{activity.map(event => {
    const p = event.payload as Record<string, unknown>;
    const amount = typeof p.amount_minor === 'number' && typeof p.currency === 'string' ? p.amount_minor : null;
    const correction = event.action === 'payment.recorded' && amount !== null && amount < 0;
    const label = correction ? 'Correction recorded' : event.action === 'invoice.issued' ? `Invoice #${p.number ?? ''} issued` : EVENT_LABEL[event.action] ?? 'Financial change';
    const detail = typeof p.description === 'string' ? p.description : typeof p.name === 'string' ? p.name : amount !== null ? formatMoney(amount, p.currency as string) : event.action === 'invoice.issued' ? `Open invoice${typeof p.currency === 'string' ? ` · ${p.currency}` : ''}` : 'Open record';
    const href = event.entity_type === 'work_item' ? workHref(organizationId, event.entity_id) : `${base}/finance/catalog`;
    const Icon = correction ? Undo2 : event.action === 'payment.recorded' ? Banknote : event.action.startsWith('price_book') ? Tag : FileText;
    return <li key={event.id}><Link href={href} className="flex items-start gap-2.5 py-2.5 text-sm hover:bg-hover">
      <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', correction ? 'text-danger' : 'text-muted')} />
      <span className="min-w-0 flex-1"><span className="block font-medium">{label}</span><span className={cx('block break-words text-xs', correction ? 'text-danger' : 'text-muted')}>{detail}</span></span>
      <time dateTime={event.occurred_at} className="shrink-0 text-xs text-muted">{shortDate(event.occurred_at)}</time>
    </Link></li>;
  })}</ul> : <PanelState>No financial activity recorded yet.</PanelState>}</OperationalPanel>;
}

/** Collections and receivables for reporting members; the full breakdown stays on Reports. */
function Collections({ finance, summary, financials, monthLabel }: { finance: string; summary: NonNullable<FinanceOperating['summary']>; financials: FinanceOperating['financials']; monthLabel: string }) {
  const peak = (currency: string) => Math.max(1, ...summary.trend.filter(v => v.currency === currency).map(v => Math.abs(Number(v.amount))));
  return <OperationalPanel title="Collections & receivables" href={`${finance}/reports`} hrefLabel="Open reports">
    <div className="grid gap-6 md:grid-cols-2">
      <div className="min-w-0"><h3 className="mb-2 text-xs font-semibold">Payments by day · {monthLabel}</h3>{summary.trend.length ? <ul className="space-y-2">{summary.trend.slice(-8).map(t => <li key={`${t.day}-${t.currency}`} className="text-xs"><div className="flex justify-between gap-2"><time dateTime={t.day}>{new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${t.day}T12:00:00Z`))}</time><span className={cx('tabular-nums', Number(t.amount) < 0 && 'text-danger')}>{formatMoney(Number(t.amount), t.currency)}</span></div><div aria-hidden className="mt-1 h-1.5 rounded bg-accent/60" style={{ width: `${Math.max(0.02, Math.abs(Number(t.amount)) / peak(t.currency)) * 100}%` }} /></li>)}</ul> : <p className="py-3 text-xs text-muted">No payments in this period.</p>}</div>
      <div className="min-w-0"><h3 className="mb-2 text-xs font-semibold">Receivables aging · current</h3>{summary.aging.length ? <dl>{summary.aging.map(a => <div key={`${a.band}-${a.currency}`} className="flex justify-between gap-2 border-b border-border py-1.5 text-xs"><dt>{a.band}</dt><dd className="tabular-nums">{formatMoney(Number(a.amount), a.currency)}</dd></div>)}</dl> : <p className="py-3 text-xs text-muted">No outstanding balances.</p>}</div>
    </div>
    {financials?.length ? <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-3">{financials.map(f => <div key={f.currency} className="contents">
      <div><dt className="text-muted">Invoiced · {monthLabel}</dt><dd className="mt-1 font-semibold tabular-nums">{formatMoney(f.invoicedMinor, f.currency)}</dd></div>
      <div><dt className="text-muted">Costs recorded</dt><dd className="mt-1 tabular-nums">{f.incurredMinor === null ? 'Unknown' : formatMoney(f.incurredMinor, f.currency)}</dd></div>
      <div><dt className="text-muted">Margin on recorded costs</dt><dd className="mt-1 tabular-nums">{f.marginMinor === null ? 'Unknown' : formatMoney(f.marginMinor, f.currency)}</dd></div>
    </div>)}</dl> : null}
  </OperationalPanel>;
}
