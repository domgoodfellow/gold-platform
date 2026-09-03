import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { priceWorkItem, type Price, type PricedLine } from '@/lib/domain/pricing/prices';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business asked to be paid, and what arrived.
 *
 * **An invoice is the quote snapshotted again, one level up from where I8 already applies.**
 * A priced line copies a catalogue row so re-pricing the catalogue cannot move a quote; an
 * invoice line copies the priced line so amending a quote cannot move a document somebody was
 * sent. The quote stays editable after issue — that is the point of copying rather than
 * pointing, and `invoice_lines` holds no foreign key back to `work_item_priced_lines` for the
 * same reason `work_item_priced_lines` holds none back to `price_book_items`.
 *
 * **Two columns that are not in the schema decide most of this file.**
 *
 *   * There is no `total_minor`. An invoice's total is `priceWorkItem` over the invoice's own
 *     lines (I4) — which is why `InvoiceLine` is a `PricedLine` with a position rather than a
 *     parallel shape: a second total would need a second calculation, and the type system is
 *     where that starts. Nothing in this file reduces an array of money.
 *   * There is no `status` and no `paid` flag. Whether an invoice is settled is arithmetic
 *     over its payments, computed in `invoiceStanding` below and stored nowhere. A status
 *     column would be a second source of truth that disagrees the first time one is written
 *     without the other — `domain-model.md`'s argument for refusing a `calendar` table.
 *
 * **A payment with no provider is what "cash" is.** *A vendor is authoritative for its own
 * events only*, so a payment that came from a processor names it and carries the processor's
 * own reference; anything a person wrote down names nobody. `recordPayment` therefore takes no
 * provider argument at all — the operator path cannot claim a payment came from somewhere it
 * did not, and the caller that legitimately needs to say so is C3's webhook, which will add
 * the argument together with the code that passes it.
 */

/** A line on an issued invoice: a `PricedLine`, copied, plus the order it reads in. */
export type InvoiceLine = PricedLine & { position: number };

export type Payment = {
  id: string;
  /**
   * Integer minor units, and **signed**. A payment recorded wrongly is corrected by recording
   * its reverse rather than by editing it: there is no update policy on the table, because
   * "never rewrite history" applies to money arriving more literally than to anything else.
   */
  amountMinor: number;
  /** The invoice's, never the caller's. `record_payment` refuses to take one as an argument. */
  currency: string;
  receivedAt: string;
  /** Null means a person wrote this down. See the note above on what that means. */
  provider: string | null;
  note: string | null;
};

export type Invoice = {
  id: string;
  workItemId: string;
  /** Per tenant and human-facing. Two businesses both having an invoice 1 is the ordinary case. */
  number: number;
  /**
   * Who was billed, as it read at issue. Snapshotted rather than joined: a customer renamed or
   * merged next year does not change who this document was addressed to (I8).
   */
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
  /**
   * What was billed, straight from the one price calculation and unreshaped — the same
   * reasoning `jobEconomics.revenue` follows. `null` only if every line was somehow struck,
   * which `issue_invoice` refuses to produce.
   */
  total: Price;
  /** What has arrived, in the invoice's currency, which is the only currency a payment can be in. */
  paidMinor: number;
  /** Billed minus paid. Negative means overpaid, which is a real thing that happens. */
  outstandingMinor: number | null;
  /** Nothing further is owed. This is the whole of "paid", and it is not a column. */
  settled: boolean;
};

const NOTE_MAX = 1000;

/**
 * What has arrived against an invoice.
 *
 * A function rather than an inline `reduce` for the reason I4 gives about prices and
 * `totalCost` gives about costs: a total looks like formatting right up until something
 * conditions it, and then every inline sum is a place the rule was forgotten. A part payment,
 * a refund and a processor fee all land here when they land anywhere.
 *
 * One number rather than one per currency — unlike `totalCost` — because `record_payment`
 * writes the invoice's own currency onto every row and takes none as an argument. A payment in
 * a currency the invoice was not issued in would need a rate, a rate has a date, and a date
 * makes this the accounting system `vision.md` refuses to be.
 */
export function totalPaid(payments: Payment[]): number {
  return payments.reduce((total, payment) => total + payment.amountMinor, 0);
}

/**
 * Where an invoice stands, and the only place paid-ness is decided.
 *
 * Pure, and takes what the caller has already read. It **calls** `priceWorkItem` rather than
 * totalling the lines itself, which is what keeps I4 true of a page showing both a quote and
 * an invoice: two documents, two sets of lines, one calculation.
 */
export function invoiceStanding(invoice: Pick<Invoice, 'lines' | 'payments'>): InvoiceStanding {
  const total = priceWorkItem(invoice.lines);
  const paidMinor = totalPaid(invoice.payments);

  if (total === null) {
    // Unreachable through `issue_invoice`, which refuses a job with nothing priced. Here for
    // the same reason `priceWorkItem` re-checks its currencies: if the guarantee is ever
    // dropped, this produces an honest absence rather than a confident zero.
    return { total, paidMinor, outstandingMinor: null, settled: false };
  }

  const outstandingMinor = total.totalMinor - paidMinor;

  return { total, paidMinor, outstandingMinor, settled: outstandingMinor <= 0 };
}

/**
 * The invoice for one job, or `null`.
 *
 * Singular because `invoices_org_work_item_unique` makes it so: a second invoice for the same
 * work is either a duplicate or a credit note, and a credit note has no caller.
 */
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
 * Turn a quote into an invoice.
 *
 * Neither the lines nor the currency nor the number are arguments, and none of them can be.
 * `issue_invoice` copies the quote, snapshots its currency, and takes the next number for that
 * business — so a caller chooses *which job*, *what date it bears* and *when it is due*, and
 * nothing else. The same distinction `addPricedLine` draws between quoting from a price book
 * and typing a number onto an invoice, applied to the invoice itself.
 *
 * **`issuedAt` is the date on the document**, optional because an invoice raised today is
 * dated today. It exists for the ordinary case of billing in arrears — work finished last
 * month, invoiced in the month it belongs to. Note that numbers still follow the order
 * invoices were raised in rather than the dates on them, which is a thing a business that
 * back-dates out of order has to notice for itself; see the migration for why numbering by
 * date would be worse.
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
    // D15: Postgres records no nullability for a function argument.
    p_issued_at: issuedAt as string,
    p_due_at: dueAt as string,
  });

  if (error) {
    if (error.code === '23505') {
      // Two distinct races share this code, and they are worth telling apart: the same job
      // invoiced twice is somebody pressing the button twice, while two different jobs racing
      // for one number is a collision that resolves itself on a retry. The unique index is
      // what settles both — deliberately not a check before the insert, which races
      // identically (I6, applied to a sequence instead of a slot).
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
 * Write down that money arrived.
 *
 * No provider argument, and no method: this path records what a person saw, which is cash and
 * every other manual payment. *Cash and manual payments never touch Stripe and are never
 * recorded as though they did* is a Never, and building this before the processor is what
 * makes it structural rather than remembered — Pneu3L takes cash, so this is not scaffolding
 * for C3, it is half the business's real payment methods.
 *
 * The currency is not an argument either. `record_payment` writes the invoice's own.
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
    // Zero is refused and negative is not: a refund or a correction is a real row, and it is
    // the only way a payment is ever undone.
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
