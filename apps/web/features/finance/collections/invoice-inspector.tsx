'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { PageDrawer, PageDrawerBody, PageDrawerContent, PageDrawerFooter, PageDrawerHeader, PageDrawerTitle } from '@/components/panels/page-drawer';
import { LineItems, MoneyTotals, RecordSummary } from '@/components/patterns/transaction-review';
import type { FinanceInvoiceRow } from '@/lib/domain/billing/finance-reads';
import type { Invoice } from '@/lib/domain/billing/invoices';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { lineItem } from '../transactions/quote-dialog';
import { PaymentDialog } from '../transactions/payment-dialog';
import { InvoiceStandingBadge, workHref } from './finance-tables';

const RETURN_KEY = 'finance-inspector-return';

/** Returns focus to the Preview control of the invoice whose inspector was just closed. */
export function InspectorFocusReturn() {
  const params = useSearchParams();
  const open = params.get('invoice');
  useEffect(() => {
    if (open) return;
    let id: string | null = null;
    try { id = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); } catch { return; }
    if (!id) return;
    // The docked rail finishes closing after the page re-renders and may move focus; re-assert briefly until it lands.
    const timers = [0, 60, 180, 400, 800].map(delay => window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-inspect-invoice="${id}"]`)].find(node => node.offsetParent !== null);
      if (target && document.activeElement !== target && (document.activeElement === document.body || !document.activeElement?.closest('[role=dialog]'))) target.focus();
    }, delay));
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [open]);
  return null;
}

/**
 * Inspecting one invoice without leaving the collection. Read-oriented: the invoice's own record
 * (the Work item's Financials) stays the authority, linked as Open full record, and recording money
 * opens the same payment dialog as everywhere else rather than a form in here. The open state is the
 * `?invoice=` address, so Back and Forward open and close it and closing keeps the collection's
 * search, filters, sort and page. Focus returns to the row's Preview control.
 */
export function InvoiceInspector({ organizationId, row, invoice, timezone, today, closeHref, mayRecord }: {
  organizationId: string; row: FinanceInvoiceRow; invoice: Invoice; timezone: string; today: string; closeHref: string; mayRecord: boolean;
}) {
  const router = useRouter();
  const date = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : 'No due date';
  const money = (minor: number) => formatMoney(minor, row.currency);
  const close = () => {
    // The collection restores focus once the address no longer names this invoice (`InspectorFocusReturn`).
    try { sessionStorage.setItem(RETURN_KEY, row.id); } catch { /* Focus simply stays where the browser puts it. */ }
    router.push(closeHref, { scroll: false });
  };
  return <PageDrawer open onOpenChange={open => { if (!open) close(); }}>
    <PageDrawerContent>
      <PageDrawerHeader><PageDrawerTitle>Invoice #{row.number}</PageDrawerTitle></PageDrawerHeader>
      <PageDrawerBody><div className="flex flex-col gap-4">
        <RecordSummary title={<span className="flex flex-wrap items-center gap-2">Invoice #{row.number} <InvoiceStandingBadge row={row} /></span>}
          subtitle={row.customerId ? <Link className="underline-offset-4 hover:underline" href={`/organizations/${organizationId}/crm/contacts/${row.customerId}`}>{row.billedTo}</Link> : row.billedTo}
          facts={[{ label: 'Issued', value: date(row.issuedAt) }, { label: 'Due', value: date(row.dueAt) }, { label: 'Currency', value: row.currency }]}>
          <MoneyTotals label="Invoice balance" rows={[
            { label: 'Total', value: row.total ? money(row.total.totalMinor) : '—' },
            { label: 'Paid', value: money(row.paidMinor), tone: 'muted' },
            { label: row.settled ? 'Outstanding (settled)' : 'Outstanding', value: row.outstandingMinor === null ? '—' : money(Math.max(0, row.outstandingMinor)), emphasis: true, tone: row.overdue ? 'danger' : undefined },
          ]} />
        </RecordSummary>
        <section aria-labelledby="inspector-lines"><h3 id="inspector-lines" className="mb-1 text-sm font-semibold">Invoiced lines</h3>
          <LineItems label="Invoiced lines" items={invoice.lines.map(line => lineItem(line))} empty="This invoice has no lines." /></section>
        <section aria-labelledby="inspector-payments"><h3 id="inspector-payments" className="mb-1 text-sm font-semibold">Payment history</h3>
          <LineItems label="Payment history" empty="No payments recorded." items={invoice.payments.map(payment => ({ key: payment.id, tone: payment.amountMinor < 0 ? 'correction' as const : undefined,
            description: payment.amountMinor < 0 ? 'Correction' : payment.provider ? `Paid through ${payment.provider}` : 'Recorded by hand',
            detail: [date(payment.receivedAt), payment.note].filter(Boolean).join(' · '), amount: money(payment.amountMinor) }))} />
          <p className="mt-2 text-xs text-muted">Entries recorded by hand are not confirmed by a payment processor.</p>
        </section>
      </div></PageDrawerBody>
      <PageDrawerFooter>
        <ButtonLink href={workHref(organizationId, row.workItemId)} tone="secondary" size="small"><ExternalLink aria-hidden className="size-4" />Open full record</ButtonLink>
        {mayRecord ? row.settled
          ? <PaymentDialog organizationId={organizationId} workItemId={row.workItemId} today={today} entry="correction" label="Record correction" size="small" />
          : <PaymentDialog organizationId={organizationId} workItemId={row.workItemId} today={today} label="Record payment" tone="primary" size="small" /> : null}
      </PageDrawerFooter>
    </PageDrawerContent>
  </PageDrawer>;
}
