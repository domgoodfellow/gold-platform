import type { Db } from '@/lib/db/types';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import { DomainError } from '@/lib/domain/errors';
import { priceWorkItem, type Price, type PricedLine } from '@/lib/domain/pricing/prices';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business asked to be paid, and what arrived. An invoice line copies the priced line
 * (I8, one level up from a priced line copying the catalogue), so amending a quote can't move a
 * document already sent. No `total_minor` column — the total is `priceWorkItem` over the
 * invoice's own lines (I4), which is why `InvoiceLine` is a `PricedLine` with a position rather
 * than a parallel shape. No `status` or `paid` flag either — settled-ness is arithmetic over
 * payments, computed in `invoiceStanding`. A payment with no provider is what "cash" means: a
 * vendor is authoritative only for its own events, so `recordPayment` takes no provider argument
 * at all.
 */

/** A line on an issued invoice: a `PricedLine`, copied, plus the order it reads in. */
export type InvoiceLine = PricedLine & { position: number };

export type Payment = {
  id: string;
  /** Signed — a mistaken payment is corrected by recording its reverse, never by editing; there's no update policy on the table. */
  amountMinor: number;
  /** The invoice's, never the caller's — `record_payment` refuses to take one as an argument. */
  currency: string;
  receivedAt: string;
  /** Null means a person wrote this down. */
  provider: string | null;
  note: string | null;
};

export type Invoice = {
  id: string;
  workItemId: string;
  /** Per tenant and human-facing. Two businesses both having an invoice 1 is the ordinary case. */
  number: number;
  /** Who was billed, as it read at issue — snapshotted rather than joined (I8). */
  billedTo: string;
  customerId: string | null;
  currency: string;
  issuedAt: string;
  dueAt: string | null;
  lines: InvoiceLine[];
  payments: Payment[];
};

/** Where an invoice stands. Derived on every read; stored in no column. */
export type InvoiceStanding = {
  /** Straight from the one price calculation (I4) and unreshaped. Null only if every line was struck, which `issue_invoice` refuses to produce. */
  total: Price;
  /** In the invoice's currency, the only currency a payment can be in. */
  paidMinor: number;
  /** Billed minus paid. Negative means overpaid, which is real. */
  outstandingMinor: number | null;
  settled: boolean;
};

const NOTE_MAX = 1000;

/** A function rather than an inline `reduce` (I4's reasoning). One number, not one per currency, since `record_payment` writes the invoice's own currency onto every row. */
export function totalPaid(payments: Payment[]): number {
  return payments.reduce((total, payment) => total + payment.amountMinor, 0);
}

/** Pure, and calls `priceWorkItem` rather than totalling lines itself — what keeps I4 true on a page showing both a quote and an invoice. */
export function invoiceStanding(invoice: Pick<Invoice, 'lines' | 'payments'>): InvoiceStanding {
  const total = priceWorkItem(invoice.lines);
  const paidMinor = totalPaid(invoice.payments);

  if (total === null) {
    // Unreachable through `issue_invoice`, which refuses a job with nothing priced. Here in case that guarantee is ever dropped.
    return { total, paidMinor, outstandingMinor: null, settled: false };
  }

  const outstandingMinor = total.totalMinor - paidMinor;

  return { total, paidMinor, outstandingMinor, settled: outstandingMinor <= 0 };
}

/** Singular because `invoices_org_work_item_unique` makes it so — a second invoice for the same work has no caller. */
export async function getInvoiceForWorkItem(
  db: Db,
  input: { organizationId: string; workItemId: string },
): Promise<Invoice | null> {
  const { data, error } = await db
    .from('invoices')
    .select('id, work_item_id, number, billed_to, customer_id, currency, issued_at, due_at')
    .eq('organization_id', input.organizationId)
    .eq('work_item_id', input.workItemId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'invoices.read_failed');
  }
  if (!data) return null;

  const [lines, payments] = await Promise.all([
    listInvoiceLines(db, { organizationId: input.organizationId, invoiceId: data.id }),
    listPayments(db, { organizationId: input.organizationId, invoiceId: data.id }),
  ]);

  return {
    id: data.id,
    workItemId: data.work_item_id,
    number: data.number,
    billedTo: data.billed_to,
    customerId: data.customer_id,
    currency: data.currency,
    issuedAt: data.issued_at,
    dueAt: data.due_at,
    lines,
    payments,
  };
}

type InvoiceRow = {
  id: string;
  work_item_id: string;
  number: number;
  billed_to: string;
  customer_id: string | null;
  currency: string;
  issued_at: string;
  due_at: string | null;
};

const INVOICE_COLUMNS = 'id, work_item_id, number, billed_to, customer_id, currency, issued_at, due_at';

/**
 * **Batched rather than one query per invoice:** two queries scoped to the invoice ids in hand,
 * one for every invoice's lines and one for every invoice's payments. Shared by every list so a
 * screen of dozens of invoices never costs two reads each.
 */
async function hydrateInvoices(db: Db, organizationId: string, invoices: InvoiceRow[]): Promise<Invoice[]> {
  if (invoices.length === 0) return [];

  const invoiceIds = invoices.map((invoice) => invoice.id);

  const [linesResult, paymentsResult] = await Promise.all([
    db
      .from('invoice_lines')
      .select('id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position')
      .eq('organization_id', organizationId)
      .in('invoice_id', invoiceIds)
      .order('position', { ascending: true }),
    db
      .from('payments')
      .select('id, invoice_id, amount_minor, currency, received_at, provider, note')
      .eq('organization_id', organizationId)
      .in('invoice_id', invoiceIds)
      .order('received_at', { ascending: true }),
  ]);

  if (linesResult.error) {
    throw new DomainError(linesResult.error.message, 'invoices.lines_failed');
  }
  if (paymentsResult.error) {
    throw new DomainError(paymentsResult.error.message, 'payments.list_failed');
  }

  const linesByInvoice = new Map<string, InvoiceLine[]>();
  for (const row of linesResult.data ?? []) {
    const existing = linesByInvoice.get(row.invoice_id) ?? [];
    existing.push({
      id: row.id,
      description: row.description,
      unit: row.unit,
      unitAmountMinor: row.unit_amount_minor,
      currency: row.currency,
      quantity: row.quantity,
      position: row.position,
    });
    linesByInvoice.set(row.invoice_id, existing);
  }

  const paymentsByInvoice = new Map<string, Payment[]>();
  for (const row of paymentsResult.data ?? []) {
    const existing = paymentsByInvoice.get(row.invoice_id) ?? [];
    existing.push({
      id: row.id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      receivedAt: row.received_at,
      provider: row.provider,
      note: row.note,
    });
    paymentsByInvoice.set(row.invoice_id, existing);
  }

  return invoices.map((row) => ({
    id: row.id,
    workItemId: row.work_item_id,
    number: row.number,
    billedTo: row.billed_to,
    customerId: row.customer_id,
    currency: row.currency,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    lines: linesByInvoice.get(row.id) ?? [],
    payments: paymentsByInvoice.get(row.id) ?? [],
  }));
}

/**
 * What this customer has actually been billed, across every job they've ever had — not which
 * jobs currently point to them. `invoices.customer_id` is snapshotted at `issue_invoice` and
 * never updated afterward (no update policy exists on `invoices` at all), so filtering on it
 * directly is already the historical truth (I8); nothing here joins through a work item's own,
 * mutable `customer_id`.
 */
export async function listCustomerInvoices(
  db: Db,
  input: { organizationId: string; customerId: string },
): Promise<Invoice[]> {
  const { data: invoices, error } = await db
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .order('issued_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'invoices.customer_read_failed');
  }
  return hydrateInvoices(db, input.organizationId, invoices ?? []);
}

/**
 * Every invoice this business has issued, newest first, to the list limit — with the total, so a
 * screen can say it is showing part. Each carries its own snapshotted lines and recorded payments;
 * standing is `invoiceStanding`'s to derive, never this reader's.
 */
export async function listInvoices(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<Counted<Invoice>> {
  const { data, error, count } = await db
    .from('invoices')
    .select(INVOICE_COLUMNS, { count: 'exact' })
    .eq('organization_id', input.organizationId)
    .order('issued_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'invoices.list_failed');
  }
  return counted(await hydrateInvoices(db, input.organizationId, data ?? []), count);
}

/** Which of these jobs already have an invoice. One query for a page of jobs, never one per job. */
export async function invoicedWorkItemIds(
  db: Db,
  input: { organizationId: string; workItemIds: string[] },
): Promise<Set<string>> {
  if (input.workItemIds.length === 0) return new Set();
  const { data, error } = await db
    .from('invoices')
    .select('work_item_id')
    .eq('organization_id', input.organizationId)
    .in('work_item_id', input.workItemIds);

  if (error) {
    throw new DomainError(error.message, 'invoices.list_failed');
  }
  return new Set((data ?? []).map((row) => row.work_item_id));
}

/** A recorded payment together with the invoice it settled, as that invoice read at issue (I8). */
export type PaymentRecord = Payment & {
  invoiceId: string;
  invoiceNumber: number;
  billedTo: string;
  customerId: string | null;
  workItemId: string;
  /** The processor's own reference. Null for a payment a person wrote down. */
  providerReference: string | null;
};

/**
 * Every payment this business has recorded, most recently received first. Customer-to-business
 * money only: `payments` holds no row for what the business pays GildOps. Two queries — the
 * payments, then the invoices they settle — rather than a join, so the invoice's own snapshot is
 * what is read (I8).
 */
export async function listOrganizationPayments(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<Counted<PaymentRecord>> {
  const { data, error, count } = await db
    .from('payments')
    .select('id, invoice_id, amount_minor, currency, received_at, provider, provider_reference, note', { count: 'exact' })
    .eq('organization_id', input.organizationId)
    .order('received_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'payments.list_failed');
  }
  const rows = data ?? [];
  if (rows.length === 0) return counted([], count);

  const { data: invoices, error: invoiceError } = await db
    .from('invoices')
    .select('id, work_item_id, number, billed_to, customer_id')
    .eq('organization_id', input.organizationId)
    .in('id', [...new Set(rows.map((row) => row.invoice_id))]);

  if (invoiceError) {
    throw new DomainError(invoiceError.message, 'invoices.list_failed');
  }
  const byId = new Map((invoices ?? []).map((invoice) => [invoice.id, invoice]));

  return counted(
    rows.flatMap((row) => {
      const invoice = byId.get(row.invoice_id);
      // A payment cannot outlive its invoice (foreign key), so this is unreachable rather than defensive.
      if (!invoice) return [];
      return [{
        id: row.id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        receivedAt: row.received_at,
        provider: row.provider,
        providerReference: row.provider_reference,
        note: row.note,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        billedTo: invoice.billed_to,
        customerId: invoice.customer_id,
        workItemId: invoice.work_item_id,
      }];
    }),
    count,
  );
}

export async function listInvoiceLines(
  db: Db,
  input: { organizationId: string; invoiceId: string },
): Promise<InvoiceLine[]> {
  const { data, error } = await db
    .from('invoice_lines')
    .select('id, description, unit, unit_amount_minor, currency, quantity, position')
    .eq('organization_id', input.organizationId)
    .eq('invoice_id', input.invoiceId)
    .order('position', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'invoices.lines_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    unit: row.unit,
    unitAmountMinor: row.unit_amount_minor,
    currency: row.currency,
    quantity: row.quantity,
    position: row.position,
  }));
}

export async function listPayments(
  db: Db,
  input: { organizationId: string; invoiceId: string },
): Promise<Payment[]> {
  const { data, error } = await db
    .from('payments')
    .select('id, amount_minor, currency, received_at, provider, note')
    .eq('organization_id', input.organizationId)
    .eq('invoice_id', input.invoiceId)
    .order('received_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'payments.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    receivedAt: row.received_at,
    provider: row.provider,
    note: row.note,
  }));
}

/**
 * Turn a quote into an invoice. Neither the lines, currency, nor number are arguments —
 * `issue_invoice` copies the quote, snapshots its currency, and takes the next number for that
 * business. `issuedAt` is optional, for the ordinary case of billing in arrears; note that
 * invoice numbers still follow issue order rather than the dates on them.
 */
export async function issueInvoice(
  db: Db,
  input: { workItemId: string; issuedAt?: string | null; dueAt?: string | null },
): Promise<string> {
  await requireActor(db);

  let issuedAt: string | null = null;
  if (input.issuedAt) {
    const issued = new Date(input.issuedAt);
    if (Number.isNaN(issued.getTime())) {
      throw new DomainError('That is not a date.', 'invoices.issued_invalid');
    }
    issuedAt = issued.toISOString();
  }

  let dueAt: string | null = null;
  if (input.dueAt) {
    const due = new Date(input.dueAt);
    if (Number.isNaN(due.getTime())) {
      throw new DomainError('That is not a date.', 'invoices.due_invalid');
    }
    dueAt = due.toISOString();
  }

  const { data, error } = await db.rpc('issue_invoice', {
    p_work_item_id: input.workItemId,
    // Postgres records no nullability for a function argument (D15).
    p_issued_at: issuedAt as string,
    p_due_at: dueAt as string,
  });

  if (error) {
    if (error.code === '23505') {
      // Two distinct races share this code: the same job invoiced twice (a double click), or
      // two jobs racing for one number (resolves on retry) — the unique index settles both.
      if (error.message.includes('invoices_org_work_item_unique')) {
        throw new DomainError(
          'This job has already been invoiced.',
          'invoices.already_issued',
        );
      }
      throw new DomainError(
        'Another invoice was issued at the same moment. Try again.',
        'invoices.number_taken',
      );
    }
    if (error.code === 'GD002') {
      throw new DomainError(
        'There is nothing priced on this job, so there is nothing to invoice.',
        'invoices.nothing_priced',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot issue invoices here.', 'invoices.forbidden');
    }
    throw new DomainError(error.message, 'invoices.issue_failed');
  }

  return data;
}

/**
 * Write down that money arrived. No provider or method argument — this path records what a
 * person saw, which is cash and every other manual payment. The currency isn't an argument
 * either: `record_payment` writes the invoice's own.
 */
export async function recordPayment(
  db: Db,
  input: {
    invoiceId: string;
    amountMinor: number;
    receivedAt?: string | null;
    note?: string | null;
  },
): Promise<string> {
  await requireActor(db);

  if (!Number.isInteger(input.amountMinor)) {
    throw new DomainError(
      'An amount is a whole number of minor units — 1250, not 12.50.',
      'payments.amount_not_integer',
    );
  }
  if (input.amountMinor === 0) {
    // Zero is refused and negative is not — a refund or correction is a real row, the only way a payment is ever undone.
    throw new DomainError('A payment of nothing is not a payment.', 'payments.amount_zero');
  }

  let receivedAt: string | null = null;
  if (input.receivedAt) {
    const received = new Date(input.receivedAt);
    if (Number.isNaN(received.getTime())) {
      throw new DomainError('That is not a time.', 'payments.received_invalid');
    }
    receivedAt = received.toISOString();
  }

  const note = input.note?.trim() || null;
  if (note && note.length > NOTE_MAX) {
    throw new DomainError(
      `That note is longer than ${NOTE_MAX} characters.`,
      'payments.note_too_long',
    );
  }

  const { data, error } = await db.rpc('record_payment', {
    p_invoice_id: input.invoiceId,
    p_amount_minor: input.amountMinor,
    p_received_at: receivedAt as string,
    p_note: note as string,
    // Null and null: this caller is a person, and a person is not a provider.
    p_provider: null as unknown as string,
    p_provider_reference: null as unknown as string,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot record payments here.', 'payments.forbidden');
    }
    throw new DomainError(error.message, 'payments.record_failed');
  }

  return data;
}
