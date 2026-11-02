import type { Db } from '@/lib/db/types';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import { DomainError } from '@/lib/domain/errors';
import { priceWorkItem, type Price, type PricedLine } from '@/lib/domain/pricing/prices';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business asked to be paid, and what arrived. An invoice line copies the priced line
 * (the preserved-history rule, one level up from a priced line copying the catalogue), so amending a quote can't move a
 * document already sent. No `total_minor` column — the total is `priceWorkItem` over the
 * invoice's own lines, which is why `InvoiceLine` is a `PricedLine` with a position rather
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

/** Where an invoice came from. A Work invoice copies its Work item's quote; a direct invoice copies catalog items; a proposal invoice copies an accepted proposal's lines. */
export type InvoiceSource = 'work_item' | 'direct' | 'proposal';

export type Invoice = {
  id: string;
  source: InvoiceSource;
  /** The Work item it invoiced. Null unless `source` is `work_item` (`invoices_source_reference`). */
  workItemId: string | null;
  /** The accepted proposal it invoiced. Null unless `source` is `proposal`. */
  proposalId: string | null;
  /** Per tenant and human-facing. Two businesses both having an invoice 1 is the ordinary case. */
  number: number;
  /** Who was billed, as it read at issue — snapshotted rather than joined. */
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
  /** Straight from the one price calculation and unreshaped. Null only if every line was struck, which `issue_invoice` refuses to produce. */
  total: Price;
  /** In the invoice's currency, the only currency a payment can be in. */
  paidMinor: number;
  /** Billed minus paid. Negative means overpaid, which is real. */
  outstandingMinor: number | null;
  settled: boolean;
};

const NOTE_MAX = 1000;

/** A function rather than an inline `reduce` (the one-calculation rule's reasoning). One number, not one per currency, since `record_payment` writes the invoice's own currency onto every row. */
export function totalPaid(payments: Payment[]): number {
  return payments.reduce((total, payment) => total + payment.amountMinor, 0);
}

/** Pure, and calls `priceWorkItem` rather than totalling lines itself — what keeps the one-calculation rule true on a page showing both a quote and an invoice. */
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
    .select(INVOICE_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('work_item_id', input.workItemId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'invoices.read_failed');
  }
  return data ? hydrateInvoice(db, input.organizationId, data) : null;
}

/** One invoice by its own id, whichever source issued it. Null when it is not this organization's or this reader may not see it (RLS). */
export async function getInvoice(
  db: Db,
  input: { organizationId: string; invoiceId: string },
): Promise<Invoice | null> {
  const { data, error } = await db
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.invoiceId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'invoices.read_failed');
  }
  return data ? hydrateInvoice(db, input.organizationId, data) : null;
}

async function hydrateInvoice(db: Db, organizationId: string, row: InvoiceRow): Promise<Invoice> {
  const [lines, payments] = await Promise.all([
    listInvoiceLines(db, { organizationId, invoiceId: row.id }),
    listPayments(db, { organizationId, invoiceId: row.id }),
  ]);
  return { ...invoiceFields(row), lines, payments };
}

/** The database's source column, held to the sources the schema allows rather than cast. */
export function invoiceSource(value: string): InvoiceSource {
  if (value === 'work_item' || value === 'direct' || value === 'proposal') return value;
  throw new DomainError(`Unknown invoice source: ${value}`, 'invoices.source_unknown');
}

function invoiceFields(row: InvoiceRow): Omit<Invoice, 'lines' | 'payments'> {
  return {
    id: row.id,
    source: invoiceSource(row.source),
    workItemId: row.work_item_id,
    proposalId: row.proposal_id,
    number: row.number,
    billedTo: row.billed_to,
    customerId: row.customer_id,
    currency: row.currency,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
  };
}

type InvoiceRow = {
  id: string;
  source: string;
  work_item_id: string | null;
  proposal_id: string | null;
  number: number;
  billed_to: string;
  customer_id: string | null;
  currency: string;
  issued_at: string;
  due_at: string | null;
};

const INVOICE_COLUMNS = 'id, source, work_item_id, proposal_id, number, billed_to, customer_id, currency, issued_at, due_at';

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
    ...invoiceFields(row),
    lines: linesByInvoice.get(row.id) ?? [],
    payments: paymentsByInvoice.get(row.id) ?? [],
  }));
}

/**
 * What this customer has actually been billed, from Work and directly — not which jobs currently
 * point to them. `invoices.customer_id` is snapshotted at `issue_invoice` and
 * never updated afterward (no update policy exists on `invoices` at all), so filtering on it
 * directly is already the historical truth; nothing here joins through a work item's own,
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
  return new Set((data ?? []).flatMap((row) => (row.work_item_id ? [row.work_item_id] : [])));
}

/** A recorded payment together with the invoice it settled, as that invoice read at issue. */
export type PaymentRecord = Payment & {
  invoiceId: string;
  invoiceNumber: number;
  billedTo: string;
  customerId: string | null;
  invoiceSource: InvoiceSource;
  /** Null when the invoice was issued directly rather than from Work. */
  workItemId: string | null;
  /** The processor's own reference. Null for a payment a person wrote down. */
  providerReference: string | null;
};

/**
 * Every payment this business has recorded, most recently received first. Customer-to-business
 * money only: `payments` holds no row for what the business pays GildOps. Two queries — the
 * payments, then the invoices they settle — rather than a join, so the invoice's own snapshot is
 * what is read.
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
    .select('id, source, work_item_id, number, billed_to, customer_id')
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
        invoiceSource: invoiceSource(invoice.source),
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
    // Postgres records no nullability for a function argument.
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

/** One line of a direct invoice as a caller asks for it: a catalog item and how many. Never an amount. */
export type DirectInvoiceLineRequest = { priceBookItemId: string; quantity: number };

const DIRECT_REFUSALS: Record<string, [string, string]> = {
  GD011: ['That customer is not in this business.', 'invoices.customer_unavailable'],
  GD012: ['A line names a catalog item this business does not have.', 'invoices.item_unavailable'],
  GD013: ["Every line must be priced in this business's trading currency.", 'invoices.currency_unsupported'],
  GD014: ['This invoice request was already used for a different invoice. Start a new invoice.', 'invoices.request_reused'],
  '22023': ['Each line needs a catalog item and a whole quantity from 1 to 1,000,000.', 'invoices.request_invalid'],
  '42501': ['You cannot issue invoices here.', 'invoices.forbidden'],
};

/**
 * Invoice a customer directly from this business's catalog, with no Work item. The caller names
 * items and quantities only: `issue_direct_invoice` copies each item's description, unit, price
 * and currency at issuance and takes the next number from the same sequence as Work invoices.
 * `issuanceKey` identifies this request, so retrying it returns the invoice it already issued.
 */
export async function issueDirectInvoice(
  db: Db,
  input: {
    organizationId: string;
    customerId: string;
    lines: DirectInvoiceLineRequest[];
    issuedAt?: string | null;
    dueAt?: string | null;
    issuanceKey: string;
  },
): Promise<string> {
  await requireActor(db);

  if (input.lines.length === 0) {
    throw new DomainError('Add at least one catalog item to the invoice.', 'invoices.no_lines');
  }
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1_000_000) {
      throw new DomainError('Quantity is a whole number from 1 to 1,000,000.', 'invoices.quantity_invalid');
    }
  }

  const { data, error } = await db.rpc('issue_direct_invoice', {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_lines: input.lines.map((line) => ({ price_book_item_id: line.priceBookItemId, quantity: line.quantity })),
    // Postgres records no nullability for a function argument.
    p_issued_at: (input.issuedAt ?? null) as string,
    p_due_at: (input.dueAt ?? null) as string,
    p_issuance_key: input.issuanceKey,
  });

  if (error) {
    const refusal = DIRECT_REFUSALS[error.code];
    if (refusal) throw new DomainError(refusal[0], refusal[1]);
    throw new DomainError(error.message, 'invoices.issue_failed');
  }
  return data;
}

const PROPOSAL_REFUSALS: Record<string, [string, string]> = {
  GD014: ['This invoice request was already used for a different invoice. Start a new invoice.', 'invoices.request_reused'],
  GD015: ['This proposal has already been invoiced.', 'invoices.proposal_already_invoiced'],
  GD019: ['Only an accepted one-off catalog proposal can be invoiced.', 'invoices.proposal_not_invoiceable'],
  GD020: ["This proposal's lines do not add up to its accepted total, so it cannot be invoiced.", 'invoices.proposal_inconsistent'],
  '22023': ['The due date is before the invoice date.', 'invoices.request_invalid'],
  '42501': ['You cannot invoice this proposal.', 'invoices.forbidden'],
};

/**
 * Invoice an accepted one-off catalog proposal, completely and once. The caller names the proposal,
 * optional dates and the request's key only: `issue_invoice_from_proposal` copies the proposal's
 * own lines, as the customer accepted them, and never reads today's catalog. Retrying with the same
 * key returns the same invoice; a proposal already invoiced is refused.
 */
export async function issueInvoiceFromProposal(
  db: Db,
  input: { proposalId: string; issuedAt?: string | null; dueAt?: string | null; issuanceKey: string },
): Promise<string> {
  await requireActor(db);

  const { data, error } = await db.rpc('issue_invoice_from_proposal', {
    p_proposal_id: input.proposalId,
    // Postgres records no nullability for a function argument.
    p_issued_at: (input.issuedAt ?? null) as string,
    p_due_at: (input.dueAt ?? null) as string,
    p_issuance_key: input.issuanceKey,
  });

  if (error) {
    const refusal = PROPOSAL_REFUSALS[error.code];
    if (refusal) throw new DomainError(refusal[0], refusal[1]);
    throw new DomainError(error.message, 'invoices.issue_failed');
  }
  return data;
}

/** The invoice issued from each of these proposals, by proposal id. At most one each (`invoices_org_proposal_unique`). */
export async function listInvoicesForProposals(
  db: Db,
  input: { organizationId: string; proposalIds: string[] },
): Promise<Record<string, { id: string; number: number }>> {
  if (input.proposalIds.length === 0) return {};
  const { data, error } = await db
    .from('invoices')
    .select('id, number, proposal_id')
    .eq('organization_id', input.organizationId)
    .in('proposal_id', input.proposalIds);
  if (error) throw new DomainError(error.message, 'invoices.list_failed');
  return Object.fromEntries((data ?? []).flatMap((row) => (row.proposal_id ? [[row.proposal_id, { id: row.id, number: row.number }]] : [])));
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
