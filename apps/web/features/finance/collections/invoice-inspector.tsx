'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, ExternalLink } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { createInvoiceDocument } from '@/app/organizations/[organizationId]/finance/actions';
import { PageDrawer, PageDrawerBody, PageDrawerContent, PageDrawerFooter, PageDrawerHeader, PageDrawerTitle } from '@/components/panels/page-drawer';
import { LineItems, MoneyTotals, RecordSummary } from '@/components/patterns/transaction-review';
import type { FinanceInvoiceRow } from '@/lib/domain/billing/finance-reads';
import type { Invoice } from '@/lib/domain/billing/invoices';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { lineItem } from '../transactions/quote-dialog';
import { PaymentDialog } from '../transactions/payment-dialog';
import { InvoiceStandingBadge, proposalHref, workHref } from './finance-tables';

/** In the business's own words: what the invoice was issued from. */
const SOURCE_LABEL = { work_item: 'Work', direct: 'Direct, from catalog items', proposal: 'Proposal' } as const;

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
 * Inspecting one invoice without leaving the collection. Read-oriented: a Work invoice's Work item
 * Financials stays its authority, linked as Open Work record; a direct or proposal invoice has no
 * Work, so this inspector is where it is read, and a proposal invoice links back as Open proposal. Recording money
 * opens the same payment dialog as everywhere else rather than a form in here. The open state is the
 * `?invoice=` address, so Back and Forward open and close it and closing keeps the collection's
 * search, filters, sort and page. Focus returns to the row's Preview control.
 */
export function InvoiceInspector({ organizationId, row, invoice, timezone, today, closeHref, mayRecord, document }: {
  organizationId: string; row: FinanceInvoiceRow; invoice: Invoice; timezone: string; today: string; closeHref: string; mayRecord: boolean;
  /** Whether the canonical PDF exists, and whether this person may create it when it does not. */
  document: { available: boolean; mayCreate: boolean };
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
          facts={[{ label: 'Source', value: SOURCE_LABEL[row.source] }, { label: 'Issued', value: date(row.issuedAt) }, { label: 'Due', value: date(row.dueAt) }, { label: 'Currency', value: row.currency }]}>
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
        <InvoiceDocumentState organizationId={organizationId} invoiceId={row.id} number={row.number} document={document} />
      </div></PageDrawerBody>
      <PageDrawerFooter>
        {document.available ? <ButtonLink href={documentHref(organizationId, row.id)} tone="secondary" size="small" prefetch={false} download><Download aria-hidden className="size-4" />Download PDF</ButtonLink> : null}
        {row.workItemId ? <ButtonLink href={workHref(organizationId, row.workItemId)} tone="secondary" size="small"><ExternalLink aria-hidden className="size-4" />Open Work record</ButtonLink> : null}
        {row.proposalId && row.customerId ? <ButtonLink href={proposalHref(organizationId, row.customerId)} tone="secondary" size="small"><ExternalLink aria-hidden className="size-4" />Open proposal</ButtonLink> : null}
        {mayRecord ? row.settled
          ? <PaymentDialog organizationId={organizationId} invoiceId={row.id} today={today} entry="correction" label="Record correction" size="small" />
          : <PaymentDialog organizationId={organizationId} invoiceId={row.id} today={today} label="Record payment" tone="primary" size="small" /> : null}
      </PageDrawerFooter>
    </PageDrawerContent>
  </PageDrawer>;
}

export const documentHref = (organizationId: string, invoiceId: string) => `/organizations/${organizationId}/finance/invoices/${invoiceId}/document`;

/**
 * The invoice's PDF: one document, created once from the invoice as issued. When issuing could not
 * create it, someone who may issue invoices creates it here; a refusal can be tried again, and the
 * invoice itself is unaffected either way.
 */
function InvoiceDocumentState({ organizationId, invoiceId, number, document }: { organizationId: string; invoiceId: string; number: number; document: { available: boolean; mayCreate: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (document.available) return null;
  const create = () => start(async () => {
    setError(null);
    const result = await createInvoiceDocument(organizationId, invoiceId);
    if (result.error) setError(result.error); else router.refresh();
  });
  return <section aria-labelledby="inspector-document"><h3 id="inspector-document" className="mb-1 text-sm font-semibold">Document</h3>
    <div className="flex flex-col items-start gap-2 text-sm">
      <p className="text-muted">{pending ? `Creating the PDF of invoice #${number}…` : `The PDF of invoice #${number} has not been created.`}</p>
      {document.mayCreate ? <Button type="button" tone="secondary" size="small" disabled={pending} onClick={create}>{pending ? 'Creating PDF…' : error ? 'Try again' : 'Create PDF'}</Button> : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  </section>;
}
