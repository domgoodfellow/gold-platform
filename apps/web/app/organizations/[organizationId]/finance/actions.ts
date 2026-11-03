'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { getInvoice, getInvoiceForWorkItem, invoiceStanding, issueDirectInvoice, issueInvoice, issueInvoiceFromProposal, recordPayment, type DirectInvoiceLineRequest } from '@/lib/domain/billing/invoices';
import { previewInvoiceEmail, type InvoiceEmailPreview } from '@/lib/domain/billing/invoice-emails';
import { retryInvoiceEmail, sendIssuedInvoiceEmail, type InvoiceEmailOutcome } from '@/lib/application/finance/send-invoice-email';
import { getContact, listContacts } from '@/lib/domain/contacts/contacts';
import { readFinanceInvoices, readFinanceQuotes } from '@/lib/domain/billing/finance-reads';
import { getWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { addPricedLine, listPricedLines } from '@/lib/domain/pricing/prices';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { todayInZone, zonedTimeToInstant } from '@/lib/domain/scheduling/window';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { ensureInvoiceDocument, renderDraftInvoice, retainCurrentLogo } from '@/lib/domain/billing/invoice-documents';
import { getCommercialProposal } from '@/lib/domain/customers/commercial-proposals';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export type FinanceChoice = { id: string; title: string; detail: string; meta: string };
export type FinanceChoicesResult = { total: number; rows: FinanceChoice[]; quotePrerequisite?: 'catalog' | 'forbidden'; mayCreateWork?: boolean; mayManageCatalog?: boolean };

/**
 * The records a Finance dialog may act on. Invoice issuance offers priced Work not yet invoiced;
 * a direct invoice offers the business's contacts; payments offer unpaid invoices (by invoice, of
 * either source), or every invoice when a correction may apply to a settled one; quoting offers
 * Work. Bounded at 25 with the exact matching total, so the dialog can say so.
 */
export async function financeChoices(organizationId: string, kind: 'invoice' | 'quote' | 'payment' | 'customer', q: string, options: { includeSettled?: boolean } = {}): Promise<FinanceChoicesResult> {
  const { db, organization } = await requireOrganization(organizationId);
  if (kind === 'customer') {
    const r = await listContacts(db, { organizationId, search: q, limit: 25 });
    return { total: r.total, rows: r.map(contact => ({ id: contact.id, title: contact.name, detail: contact.email ?? contact.phone ?? '', meta: '' })) };
  }
  if (kind === 'invoice') {
    const r = await readFinanceQuotes(db, organizationId, { q, status: 'not-invoiced' });
    return { total: r.total, rows: r.rows.map(r => ({ id: r.workItemId, title: r.title, detail: r.customer?.name ?? 'No contact', meta: r.quoted ? formatMoney(r.quoted.totalMinor, r.quoted.currency) : '' })) };
  }
  if (kind === 'payment') {
    const r = await readFinanceInvoices(db, organizationId, { q, status: options.includeSettled ? undefined : 'outstanding', sort: 'due' });
    const due = (iso: string | null) => iso ? `due ${new Intl.DateTimeFormat('en-CA', { timeZone: organization.timezone, month: 'short', day: 'numeric' }).format(new Date(iso))}` : 'no due date';
    return { total: r.total, rows: r.rows.map(r => ({ id: r.id, title: `Invoice #${r.number}`, detail: `${r.billedTo} · ${r.settled ? 'settled' : r.overdue ? `overdue, ${due(r.dueAt)}` : due(r.dueAt)}`, meta: r.outstandingMinor === null ? '' : `${formatMoney(Math.max(r.outstandingMinor, 0), r.currency)} due` })) };
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

/** One invoice for the payment dialog to review, by its own id, so a direct invoice is as payable as a Work one. */
export async function financePaymentReview(organizationId: string, invoiceId: string) {
  const { db } = await requireOrganization(organizationId);
  const invoice = await getInvoice(db, { organizationId, invoiceId });
  if (!invoice) throw new Error('Invoice is unavailable.');
  return { invoice };
}

/** The customer a direct invoice is for, and what the catalog offers. Prices shown here are for review; issuance re-reads them. */
export async function financeDirectInvoiceReview(organizationId: string, customerId: string) {
  const { db, organization } = await requireOrganization(organizationId);
  const [customer, items] = await Promise.all([getContact(db, { organizationId, customerId }), listPriceBookItems(db, { organizationId })]);
  if (!customer) throw new Error('Customer is unavailable.');
  return { customer: { id: customer.id, name: customer.name }, items, currency: organization.currency };
}

export type FinanceActionState = { error: string | null; success?: string; href?: string; record?: string;
  /** The invoice was issued but its PDF was not created; it can be created again from the invoice. */
  documentError?: string };

/**
 * The one write path for Finance's dialogs, each kind through its existing domain command and
 * capability. An invoice is issued from Work, with `source=direct` for a customer from catalog
 * items, or with `source=proposal` from an accepted proposal: the form carries item ids and
 * quantities, or only the proposal, and never an amount. A payment names its
 * invoice; a form from before payments were keyed by invoice still names the Work item instead. Issuing an invoice and recording a correction both need `confirmed=1`, which only
 * the dialog's confirmation step sends, so neither happens from a single casual submit. A payment
 * names its entry: a receipt is a positive amount and a correction is entered as a positive
 * amount and recorded as a negative row — never an edit of an earlier one. A form without `entry`
 * keeps the original signed-amount contract.
 */
export async function financeMutation(_previous: FinanceActionState, form: FormData): Promise<FinanceActionState> {
  const organizationId = String(form.get('organizationId') ?? '');
  const { db, organization } = await requireOrganization(organizationId);
  const workItemId = String(form.get('workItemId') ?? '');
  const invoiceId = String(form.get('invoiceId') ?? '');
  const kind = String(form.get('kind') ?? '');
  const direct = kind === 'invoice' && form.get('source') === 'direct';
  const fromProposal = kind === 'invoice' && form.get('source') === 'proposal';
  const confirmed = form.get('confirmed') === '1';
  try {
    const capability = kind === 'invoice' ? 'invoice.issue' : kind === 'quote' ? 'work_item.price' : 'payment.record';
    if (!organization.capabilities.includes(capability)) throw new DomainError('Your role cannot perform this action.', 'finance.forbidden');
    if (!(await listUsableModules(db, { organizationId })).has('billing')) throw new DomainError('Billing is not available for this organization.', 'finance.unavailable');
    const byWork = !direct && !fromProposal && !(kind === 'payment' && invoiceId);
    if (byWork && !await getWorkItem(db, { organizationId, workItemId })) throw new DomainError('Work item is unavailable.', 'finance.work_unavailable');
    const date = (name: string) => { const value = String(form.get(name) ?? ''); if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new DomainError('Enter a valid date.', 'finance.date_invalid'); return zonedTimeToInstant(value, '00:00', organization.timezone); };
    let record: string | undefined;
    let issuedId: string | undefined;
    // Before issuing, so the presentation recorded with the invoice can keep the current logo. Best effort.
    if (kind === 'invoice' && confirmed) await retainCurrentLogo(db, { organizationId }).catch(() => undefined);
    let href = `/organizations/${organizationId}/work/${workItemId}?tab=financials`;
    if (direct) {
      if (!confirmed) throw new DomainError('Review and confirm the invoice before issuing it.', 'finance.confirmation_required');
      const issuedAt = date('issuedAt'), dueAt = date('dueAt');
      if (dueAt && dueAt < (issuedAt ?? zonedTimeToInstant(todayInZone(organization.timezone), '00:00', organization.timezone))) throw new DomainError('Due date must be on or after the invoice date.', 'finance.due_invalid');
      const id = await issueDirectInvoice(db, { organizationId, customerId: String(form.get('customerId') ?? ''), lines: directLines(form.get('lines')), issuedAt, dueAt, issuanceKey: String(form.get('issuanceKey') ?? '') });
      const issued = await getInvoice(db, { organizationId, invoiceId: id });
      record = issued ? `Invoice #${issued.number}` : undefined;
      issuedId = id;
      href = `/organizations/${organizationId}/finance/invoices?invoice=${id}`;
    } else if (fromProposal) {
      if (!confirmed) throw new DomainError('Review and confirm the invoice before issuing it.', 'finance.confirmation_required');
      const issuedAt = date('issuedAt'), dueAt = date('dueAt');
      if (dueAt && dueAt < (issuedAt ?? zonedTimeToInstant(todayInZone(organization.timezone), '00:00', organization.timezone))) throw new DomainError('Due date must be on or after the invoice date.', 'finance.due_invalid');
      const id = await issueInvoiceFromProposal(db, { proposalId: String(form.get('proposalId') ?? ''), issuedAt, dueAt, issuanceKey: String(form.get('issuanceKey') ?? '') });
      const issued = await getInvoice(db, { organizationId, invoiceId: id });
      record = issued ? `Invoice #${issued.number}` : undefined;
      issuedId = id;
      href = `/organizations/${organizationId}/finance/invoices?invoice=${id}`;
      if (issued?.customerId) revalidatePath(`/organizations/${organizationId}/crm/contacts/${issued.customerId}`);
    } else if (kind === 'quote') {
      await addPricedLine(db, { workItemId, priceBookItemId: String(form.get('priceBookItemId') ?? ''), quantity: Number(form.get('quantity')) });
    } else if (kind === 'invoice') {
      if (!confirmed) throw new DomainError('Review and confirm the invoice before issuing it.', 'finance.confirmation_required');
      const issuedAt = date('issuedAt'), dueAt = date('dueAt');
      if (dueAt && dueAt < (issuedAt ?? zonedTimeToInstant(todayInZone(organization.timezone), '00:00', organization.timezone))) throw new DomainError('Due date must be on or after the invoice date.', 'finance.due_invalid');
      await issueInvoice(db, { workItemId, issuedAt, dueAt });
      const issued = await getInvoiceForWorkItem(db, { organizationId, workItemId });
      record = issued ? `Invoice #${issued.number}` : undefined;
      issuedId = issued?.id;
    } else if (kind === 'payment') {
      const invoice = invoiceId ? await getInvoice(db, { organizationId, invoiceId }) : await getInvoiceForWorkItem(db, { organizationId, workItemId });
      if (!invoice) throw new DomainError('Invoice is unavailable.', 'finance.invoice_unavailable');
      const amount = String(form.get('amount') ?? '').trim();
      const entry = form.get('entry');
      if ((entry === 'receipt' || entry === 'correction') && amount.startsWith('-')) throw new DomainError(entry === 'receipt' ? 'Enter the amount received without a minus sign. To reverse money, choose Correction or refund.' : 'Enter the correction as a positive amount; it is recorded as money returned.', 'finance.amount_sign');
      if (entry === 'correction' && !confirmed) throw new DomainError('Confirm the correction before recording it.', 'finance.confirmation_required');
      const minor = parseMoneyInput(amount, invoice.currency) * (entry === 'correction' ? -1 : 1);
      await recordPayment(db, { invoiceId: invoice.id, amountMinor: minor, receivedAt: date('receivedAt'), note: String(form.get('note') ?? '') });
      record = `${formatMoney(minor, invoice.currency)} on invoice #${invoice.number}`;
      href = invoice.workItemId ? `/organizations/${organizationId}/work/${invoice.workItemId}?tab=financials` : `/organizations/${organizationId}/finance/invoices?invoice=${invoice.id}`;
      if (invoice.workItemId) revalidatePath(`/organizations/${organizationId}/work/${invoice.workItemId}`);
    } else throw new DomainError('Unknown action.', 'finance.action_invalid');
    // A separate failure boundary: the invoice is issued whatever happens here, and its PDF can be created again later.
    let documentError: string | undefined;
    if (issuedId) await ensureInvoiceDocument(db, { organizationId, invoiceId: issuedId }).catch((error: unknown) => {
      documentError = error instanceof DomainError ? error.message : 'The invoice PDF could not be created. Try again from the invoice.';
    });
    revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
    if (byWork) revalidatePath(`/organizations/${organizationId}/work/${workItemId}`);
    return { documentError, error: null, success: kind === 'invoice' ? 'Invoice issued.' : kind === 'quote' ? 'Priced line added to quote.' : form.get('entry') === 'correction' ? 'Correction recorded.' : 'Payment recorded.', href, record };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
}

/** A direct invoice's lines as the form sends them: item ids and quantities, and nothing else is read. */
function directLines(value: FormDataEntryValue | null): DirectInvoiceLineRequest[] {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value ?? '')); } catch { throw new DomainError('The invoice lines could not be read.', 'finance.lines_invalid'); }
  if (!Array.isArray(parsed)) throw new DomainError('The invoice lines could not be read.', 'finance.lines_invalid');
  return parsed.map(line => {
    const entry = (line ?? {}) as { priceBookItemId?: unknown; quantity?: unknown };
    return { priceBookItemId: String(entry.priceBookItemId ?? ''), quantity: Number(entry.quantity) };
  });
}

/** Create an issued invoice's PDF when issuing could not. Returns the existing one when it already exists. */
export async function createInvoiceDocument(organizationId: string, invoiceId: string): Promise<{ error: string | null }> {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('invoice.issue')) return { error: 'Your role cannot create invoice documents.' };
  try {
    await ensureInvoiceDocument(db, { organizationId, invoiceId });
    revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
    return { error: null };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
}

/**
 * A draft of the invoice the dialog is about to issue, as a PDF, with the business's current
 * identity and stamped DRAFT. Takes the same fields the dialog would submit, reads the lines the
 * same way issuance does, and writes nothing.
 */
export async function previewInvoiceDocument(fields: Record<string, string>): Promise<{ pdf: string } | { error: string }> {
  const organizationId = fields.organizationId ?? '';
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('invoice.issue')) return { error: 'Your role cannot preview invoices.' };
  const day = (value: string | undefined) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? zonedTimeToInstant(value, '00:00', organization.timezone) : null;
  try {
    let customerId: string | null = null, billedTo = '', currency = organization.currency ?? '';
    let lines: { description: string; unit: string; unitAmountMinor: number; currency: string; quantity: number }[];
    if (fields.source === 'proposal') {
      const proposal = await getCommercialProposal(db, { organizationId, proposalId: fields.proposalId ?? '' });
      if (!proposal) throw new DomainError('That proposal is unavailable.', 'finance.proposal_unavailable');
      customerId = proposal.customerId; currency = proposal.currency;
      lines = proposal.lines.map(line => ({ description: line.name, unit: line.unit, unitAmountMinor: line.unitAmountMinor, currency: line.currency, quantity: line.quantity }));
    } else if (fields.source === 'direct') {
      const items = await listPriceBookItems(db, { organizationId });
      customerId = fields.customerId || null;
      lines = directLines(fields.lines ?? '').map(line => {
        const item = items.find(entry => entry.id === line.priceBookItemId);
        if (!item) throw new DomainError('Choose a catalog item for each line.', 'finance.lines_invalid');
        return { description: item.name, unit: item.unit, unitAmountMinor: item.unitAmountMinor, currency: item.currency, quantity: line.quantity };
      });
    } else {
      const work = await getWorkItem(db, { organizationId, workItemId: fields.workItemId ?? '' });
      if (!work) throw new DomainError('Work item is unavailable.', 'finance.work_unavailable');
      customerId = work.customer?.id ?? null;
      billedTo = work.customer ? '' : 'Customer';
      lines = await listPricedLines(db, { organizationId, workItemId: work.id });
    }
    if (!lines.length) throw new DomainError('There is nothing to preview yet.', 'finance.lines_invalid');
    currency = lines[0].currency || currency;
    const pdf = await renderDraftInvoice(db, { organizationId, customerId, billedTo, currency, lines, issuedAt: day(fields.issuedAt), dueAt: day(fields.dueAt), timezone: organization.timezone, organizationName: organization.name });
    return { pdf: Buffer.from(pdf).toString('base64') };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
}

export type InvoiceEmailDraft = {
  number: number; customer: string; amount: string; preview: InvoiceEmailPreview; subject: string; text: string;
};

/**
 * What the Send invoice dialog shows: the sender and recipient the database would use, the PDF it
 * would attach, and an editable subject and message in the business's own name. Writes nothing.
 */
export async function invoiceEmailDraft(organizationId: string, invoiceId: string): Promise<{ draft: InvoiceEmailDraft } | { error: string }> {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('invoice.issue') || !organization.capabilities.includes('message.send')) return { error: 'Your role cannot email invoices.' };
  try {
    const [invoice, preview] = await Promise.all([getInvoice(db, { organizationId, invoiceId }), previewInvoiceEmail(db, { organizationId, invoiceId })]);
    if (!invoice) return { error: 'That invoice is unavailable.' };
    const total = invoiceStanding(invoice).total;
    const amount = total ? formatMoney(total.totalMinor, invoice.currency) : '—';
    const due = invoice.dueAt ? `, due ${new Intl.DateTimeFormat('en-CA', { timeZone: organization.timezone, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(invoice.dueAt))}` : '';
    return { draft: {
      number: invoice.number, customer: invoice.billedTo, amount, preview,
      subject: `Invoice #${invoice.number} from ${organization.name}`,
      text: `Hello ${invoice.billedTo},\n\nPlease find invoice #${invoice.number} attached, for ${amount}${due}.\n\nThank you,\n${organization.name}`,
    } };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
}

/** Send invoice: the invoice's recorded PDF to its customer, from the business's own sender. */
export async function sendInvoiceEmail(input: {
  organizationId: string; invoiceId: string; recipient: string; subject: string; text: string; idempotencyKey: string; sendAgain: boolean;
}): Promise<{ outcome: InvoiceEmailOutcome } | { error: string; code: string }> {
  const { db, organization } = await requireOrganization(input.organizationId);
  if (!organization.capabilities.includes('invoice.issue') || !organization.capabilities.includes('message.send')) return { error: 'Your role cannot email invoices.', code: 'invoice_emails.forbidden' };
  try {
    const outcome = await sendIssuedInvoiceEmail(db, {
      organizationId: input.organizationId, invoiceId: input.invoiceId, recipient: String(input.recipient), subject: String(input.subject),
      text: String(input.text), idempotencyKey: String(input.idempotencyKey), sendAgain: input.sendAgain === true,
    });
    revalidatePath(`/organizations/${input.organizationId}/finance`, 'layout');
    return { outcome };
  } catch (error) { if (error instanceof DomainError) return { error: error.message, code: error.code }; throw error; }
}

/** Try once more to hand over a send that has not left. The same message; never a second email. */
export async function retryInvoiceEmailSend(organizationId: string, invoiceId: string, invoiceEmailId: string): Promise<{ outcome: InvoiceEmailOutcome } | { error: string }> {
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('message.send')) return { error: 'Your role cannot send email.' };
  try {
    const outcome = await retryInvoiceEmail(db, { organizationId, invoiceId, invoiceEmailId });
    revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
    return { outcome };
  } catch (error) { if (error instanceof DomainError) return { error: error.message }; throw error; }
}
