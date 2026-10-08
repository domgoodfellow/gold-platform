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

export async function financeChoices(organizationId: string, kind: 'invoice' | 'quote' | 'payment', q: string) {
  const { db } = await requireOrganization(organizationId);
  if (kind === 'invoice') { const r = await readFinanceQuotes(db, organizationId, { q, status: 'not-invoiced' }); return { total: r.total, rows: r.rows.map(r => ({ id: r.workItemId, label: `${r.title} · ${r.customer?.name ?? 'No customer'}` })) }; }
  if (kind === 'payment') { const r = await readFinanceInvoices(db, organizationId, { q, status: 'outstanding' }); return { total: r.total, rows: r.rows.map(r => ({ id: r.workItemId, label: `#${r.number} · ${r.billedTo}` })) }; }
  const r = await listWorkItems(db, { organizationId, q, limit: 25 });
  return { total: r.total, rows: r.map(r => ({ id: r.id, label: r.title })) };
}

export async function financeReview(organizationId: string, workItemId: string) {
  const { db } = await requireOrganization(organizationId);
  const work = await getWorkItem(db, { organizationId, workItemId });
  if (!work) throw new Error('Work item is unavailable.');
  const [invoice, lines, items] = await Promise.all([getInvoiceForWorkItem(db, { organizationId, workItemId }), listPricedLines(db, { organizationId, workItemId }), listPriceBookItems(db, { organizationId })]);
  return { work, invoice, lines, items };
}

export type FinanceActionState = { error: string | null; success?: string; href?: string };

export async function financeMutation(_previous: FinanceActionState, form: FormData): Promise<FinanceActionState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db, organization } = await requireOrganization(organizationId);
  const workItemId = String(form.get('workItemId') ?? '');
  const kind = String(form.get('kind') ?? '');
  try {
    const capability = kind === 'invoice' ? 'invoice.issue' : kind === 'quote' ? 'work_item.price' : 'payment.record';
    if (!organization.capabilities.includes(capability)) throw new DomainError('Your role cannot perform this action.', 'finance.forbidden');
    if (!(await listUsableModules(db, { organizationId })).has('billing')) throw new DomainError('Billing is not available for this organization.', 'finance.unavailable');
    if (!await getWorkItem(db, { organizationId, workItemId })) throw new DomainError('Work item is unavailable.', 'finance.work_unavailable');
    const date = (name: string) => { const value = String(form.get(name) ?? ''); if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new DomainError('Enter a valid date.', 'finance.date_invalid'); return zonedTimeToInstant(value, '00:00', organization.timezone); };
    if (kind === 'quote') {
      await addPricedLine(db, { workItemId, priceBookItemId: String(form.get('priceBookItemId') ?? ''), quantity: Number(form.get('quantity')) });
    } else if (kind === 'invoice') {
      const issuedAt = date('issuedAt'), dueAt = date('dueAt');
      if (dueAt && dueAt < (issuedAt ?? zonedTimeToInstant(todayInZone(organization.timezone), '00:00', organization.timezone))) throw new DomainError('Due date must be on or after the invoice date.', 'finance.due_invalid');
      await issueInvoice(db, { workItemId, issuedAt, dueAt });
    } else if (kind === 'payment') {
      const invoice = await getInvoiceForWorkItem(db, { organizationId, workItemId });
      if (!invoice) throw new DomainError('Invoice is unavailable.', 'finance.invoice_unavailable');
      const amount = String(form.get('amount') ?? '').trim();
      const minor = parseMoneyInput(amount, invoice.currency);
      await recordPayment(db, { invoiceId: invoice.id, amountMinor: minor, receivedAt: date('receivedAt'), note: String(form.get('note') ?? '') });
    } else throw new DomainError('Unknown action.', 'finance.action_invalid');
    revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
    revalidatePath(`/organizations/${organizationId}/work/${workItemId}`);
    return { error: null, success: kind === 'invoice' ? 'Invoice issued.' : kind === 'quote' ? 'Priced line added to quote.' : 'Payment recorded.', href: `/organizations/${organizationId}/work/${workItemId}?tab=financials` };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
}
