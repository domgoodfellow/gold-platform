'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { getInvoiceForWorkItem, issueInvoice, recordPayment } from '@/lib/domain/billing/invoices';
import { readFinanceInvoices, readFinanceQuotes } from '@/lib/domain/billing/finance-reads';
import { getWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { addPricedLine, listPricedLines } from '@/lib/domain/pricing/prices';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { todayInZone, zonedTimeToInstant } from '@/lib/domain/scheduling/window';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export type FinanceChoice = { id: string; title: string; detail: string; meta: string };
export type FinanceChoicesResult = { total: number; rows: FinanceChoice[]; quotePrerequisite?: 'catalog' | 'forbidden'; mayCreateWork?: boolean; mayManageCatalog?: boolean };

/**
 * The records a Finance dialog may act on. Invoice issuance offers priced Work not yet invoiced;
 * payments offer unpaid invoices, or every invoice when a correction may apply to a settled one;
 * quoting offers Work. Bounded at 25 with the exact matching total, so the dialog can say so.
 */
export async function financeChoices(organizationId: string, kind: 'invoice' | 'quote' | 'payment', q: string, options: { includeSettled?: boolean } = {}): Promise<FinanceChoicesResult> {
  const { db, organization } = await requireOrganization(organizationId);
  if (kind === 'invoice') {
    const r = await readFinanceQuotes(db, organizationId, { q, status: 'not-invoiced' });
    return { total: r.total, rows: r.rows.map(r => ({ id: r.workItemId, title: r.title, detail: r.customer?.name ?? 'No contact', meta: r.quoted ? formatMoney(r.quoted.totalMinor, r.quoted.currency) : '' })) };
  }
  if (kind === 'payment') {
    const r = await readFinanceInvoices(db, organizationId, { q, status: options.includeSettled ? undefined : 'outstanding', sort: 'due' });
    const due = (iso: string | null) => iso ? `due ${new Intl.DateTimeFormat('en-CA', { timeZone: organization.timezone, month: 'short', day: 'numeric' }).format(new Date(iso))}` : 'no due date';
    return { total: r.total, rows: r.rows.map(r => ({ id: r.workItemId, title: `Invoice #${r.number}`, detail: `${r.billedTo} · ${r.settled ? 'settled' : r.overdue ? `overdue, ${due(r.dueAt)}` : due(r.dueAt)}`, meta: r.outstandingMinor === null ? '' : `${formatMoney(Math.max(r.outstandingMinor, 0), r.currency)} due` })) };
  }
  if (!organization.capabilities.includes('work_item.price')) return { total: 0, rows: [], quotePrerequisite: 'forbidden' };
  const [r, items] = await Promise.all([listWorkItems(db, { organizationId, q, limit: 25 }), listPriceBookItems(db, { organizationId })]);
  return { total: r.total, rows: r.map(r => ({ id: r.id, title: r.title, detail: `${r.customer?.label ?? 'No contact'} · ${r.status.label}`, meta: '' })),
    ...(items.length ? {} : { quotePrerequisite: 'catalog' as const }), mayCreateWork: organization.capabilities.includes('work_item.create'), mayManageCatalog: organization.capabilities.includes('price.manage') };
}

export async function financeReview(organizationId: string, workItemId: string) {
  const { db } = await requireOrganization(organizationId);
  const work = await getWorkItem(db, { organizationId, workItemId });
  if (!work) throw new Error('Work item is unavailable.');
  const [invoice, lines, items] = await Promise.all([getInvoiceForWorkItem(db, { organizationId, workItemId }), listPricedLines(db, { organizationId, workItemId }), listPriceBookItems(db, { organizationId })]);
  return { work, invoice, lines, items };
}

export type FinanceActionState = { error: string | null; success?: string; href?: string; record?: string };

/**
 * The one write path for Finance's dialogs, each kind through its existing domain command and
 * capability. Issuing an invoice and recording a correction both need `confirmed=1`, which only
 * the dialog's confirmation step sends, so neither happens from a single casual submit. A payment
 * names its entry: a receipt is a positive amount and a correction is entered as a positive
 * amount and recorded as a negative row — never an edit of an earlier one. A form without `entry`
 * keeps the original signed-amount contract.
 */
export async function financeMutation(_previous: FinanceActionState, form: FormData): Promise<FinanceActionState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db, organization } = await requireOrganization(organizationId);
  const workItemId = String(form.get('workItemId') ?? '');
  const kind = String(form.get('kind') ?? '');
  const confirmed = form.get('confirmed') === '1';
  try {
    const capability = kind === 'invoice' ? 'invoice.issue' : kind === 'quote' ? 'work_item.price' : 'payment.record';
    if (!organization.capabilities.includes(capability)) throw new DomainError('Your role cannot perform this action.', 'finance.forbidden');
    if (!(await listUsableModules(db, { organizationId })).has('billing')) throw new DomainError('Billing is not available for this organization.', 'finance.unavailable');
    if (!await getWorkItem(db, { organizationId, workItemId })) throw new DomainError('Work item is unavailable.', 'finance.work_unavailable');
    const date = (name: string) => { const value = String(form.get(name) ?? ''); if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new DomainError('Enter a valid date.', 'finance.date_invalid'); return zonedTimeToInstant(value, '00:00', organization.timezone); };
    let record: string | undefined;
    if (kind === 'quote') {
      await addPricedLine(db, { workItemId, priceBookItemId: String(form.get('priceBookItemId') ?? ''), quantity: Number(form.get('quantity')) });
    } else if (kind === 'invoice') {
      if (!confirmed) throw new DomainError('Review and confirm the invoice before issuing it.', 'finance.confirmation_required');
      const issuedAt = date('issuedAt'), dueAt = date('dueAt');
      if (dueAt && dueAt < (issuedAt ?? zonedTimeToInstant(todayInZone(organization.timezone), '00:00', organization.timezone))) throw new DomainError('Due date must be on or after the invoice date.', 'finance.due_invalid');
      await issueInvoice(db, { workItemId, issuedAt, dueAt });
      const issued = await getInvoiceForWorkItem(db, { organizationId, workItemId });
      record = issued ? `Invoice #${issued.number}` : undefined;
    } else if (kind === 'payment') {
      const invoice = await getInvoiceForWorkItem(db, { organizationId, workItemId });
      if (!invoice) throw new DomainError('Invoice is unavailable.', 'finance.invoice_unavailable');
      const amount = String(form.get('amount') ?? '').trim();
      const entry = form.get('entry');
      if ((entry === 'receipt' || entry === 'correction') && amount.startsWith('-')) throw new DomainError(entry === 'receipt' ? 'Enter the amount received without a minus sign. To reverse money, choose Correction or refund.' : 'Enter the correction as a positive amount; it is recorded as money returned.', 'finance.amount_sign');
      if (entry === 'correction' && !confirmed) throw new DomainError('Confirm the correction before recording it.', 'finance.confirmation_required');
      const minor = parseMoneyInput(amount, invoice.currency) * (entry === 'correction' ? -1 : 1);
      await recordPayment(db, { invoiceId: invoice.id, amountMinor: minor, receivedAt: date('receivedAt'), note: String(form.get('note') ?? '') });
      record = `${formatMoney(minor, invoice.currency)} on invoice #${invoice.number}`;
    } else throw new DomainError('Unknown action.', 'finance.action_invalid');
    revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
    revalidatePath(`/organizations/${organizationId}/work/${workItemId}`);
    return { error: null, success: kind === 'invoice' ? 'Invoice issued.' : kind === 'quote' ? 'Priced line added to quote.' : form.get('entry') === 'correction' ? 'Correction recorded.' : 'Payment recorded.', href: `/organizations/${organizationId}/work/${workItemId}?tab=financials`, record };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
}
