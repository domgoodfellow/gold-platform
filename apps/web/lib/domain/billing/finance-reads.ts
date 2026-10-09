import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { PaymentRecord } from './invoices';
import type { Price } from '@/lib/domain/pricing/prices';

export type FinanceInvoiceRow = {
  id: string;
  workItemId: string;
  number: number;
  billedTo: string;
  customerId: string | null;
  currency: string;
  issuedAt: string;
  dueAt: string | null;
  total: Price;
  paidMinor: number;
  outstandingMinor: number | null;
  settled: boolean;
  /** Unpaid past a due date the business set. False when no due date was set — never inferred from the issue date. */
  overdue: boolean;
};

export type FinanceQuoteRow = {
  workItemId: string;
  title: string;
  status: string;
  customer: { id: string; name: string } | null;
  createdAt: string;
  lineCount: number;
  quoted: Price;
  /** Whether an invoice already exists for this job. Invoicing is the invoice's own fact, read from `invoices`. */
  invoiced: boolean;
};

export type FinanceFilter = { q?: string; status?: string; customer?: string; from?: string; to?: string; dueFrom?: string; dueTo?: string; page?: number; limit?: number };
export type CurrencyAmount = { currency: string; amount: string; count: number };
export type FinanceSummary = {
  issued: number; outstandingCount: number; overdueCount: number; quoteCount: number; paymentCount: number;
  outstanding: CurrencyAmount[]; quoted: CurrencyAmount[]; received: CurrencyAmount[];
  aging: { currency: string; band: string; amount: string }[];
  trend: { day: string; currency: string; amount: string }[];
};

export async function readFinanceSummary(db: Db, organizationId: string, from: string, to: string): Promise<FinanceSummary> {
  const { data, error } = await db.rpc('finance_dashboard_summary', { p_organization_id: organizationId, p_from: from, p_to: to });
  if (error) throw new DomainError(error.message, 'finance.summary_failed');
  const result = data as unknown as FinanceSummary;
  for (const row of [...result.outstanding, ...result.quoted, ...result.received, ...result.aging, ...result.trend]) safeMinor(row.amount);
  return result;
}

function safeMinor(value: string | number): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new DomainError('This financial amount exceeds the supported display range.', 'finance.amount_out_of_range');
  return amount;
}

const searchTerm = (q: string) => q.trim().replace(/[^\p{L}\p{N}\s@._-]/gu, '').slice(0, 100);
const bounds = (f: FinanceFilter) => { const size = Math.min(50, Math.max(1, f.limit ?? 25)); const start = (Math.max(1, f.page ?? 1) - 1) * size; return [start, start + size - 1] as const; };

export async function readFinanceActivity(db: Db, organizationId: string) {
  const { data, error } = await db.from('events').select('id,entity_type,entity_id,action,payload,occurred_at').eq('organization_id', organizationId)
    .in('action', ['invoice.issued', 'payment.recorded', 'work_item.line_added', 'work_item.line_removed', 'price_book_item.created', 'price_book_item.updated']).order('occurred_at', { ascending: false }).limit(5);
  if (error) throw new DomainError(error.message, 'finance.activity_failed');
  return data ?? [];
}

export async function readFinanceInvoices(db: Db, organizationId: string, f: FinanceFilter = {}) {
  let query = db.from('finance_invoice_records').select('*', { count: 'exact' }).eq('organization_id', organizationId);
  if (f.status === 'outstanding') query = query.eq('settled', false);
  if (f.status === 'overdue') query = query.eq('overdue', true);
  if (f.status === 'settled') query = query.eq('settled', true);
  if (f.customer) query = query.eq('customer_id', f.customer);
  if (f.from) query = query.gte('issued_at', f.from);
  if (f.to) query = query.lt('issued_at', f.to);
  if (f.dueFrom) query = query.gte('due_at', f.dueFrom);
  if (f.dueTo) query = query.lt('due_at', f.dueTo);
  if (f.q && searchTerm(f.q)) { const q = searchTerm(f.q); query = /^#?\d+$/.test(f.q.trim()) ? query.eq('number', Number(f.q.replace('#', ''))) : query.ilike('billed_to', `%${q}%`); }
  const { data, error, count } = await query.order('issued_at', { ascending: false }).order('id').range(...bounds(f));
  if (error) throw new DomainError(error.message, 'invoices.list_failed');
  if (count === null) throw new DomainError('Invoice count unavailable.', 'invoices.count_failed');
  const rows: FinanceInvoiceRow[] = (data ?? []).map(r => ({ id: r.id!, workItemId: r.work_item_id!, number: r.number!, billedTo: r.billed_to!, customerId: r.customer_id,
    currency: r.currency!, issuedAt: r.issued_at!, dueAt: r.due_at, total: r.total_minor === null ? null : { totalMinor: safeMinor(r.total_minor), currency: r.currency! },
    paidMinor: safeMinor(r.paid_minor ?? 0), outstandingMinor: r.outstanding_minor === null ? null : safeMinor(r.outstanding_minor), settled: r.settled ?? false, overdue: r.overdue ?? false }));
  return { rows, total: count ?? 0 };
}

export async function readFinanceQuotes(db: Db, organizationId: string, f: FinanceFilter = {}) {
  let query = db.from('finance_quote_records').select('*', { count: 'exact' }).eq('organization_id', organizationId);
  if (f.status === 'not-invoiced') query = query.eq('invoiced', false);
  if (f.status === 'invoiced') query = query.eq('invoiced', true);
  if (f.customer) query = query.eq('customer_id', f.customer);
  if (f.from) query = query.gte('created_at', f.from);
  if (f.to) query = query.lt('created_at', f.to);
  if (f.q && searchTerm(f.q)) { const q = searchTerm(f.q); query = query.or(`title.ilike.%${q}%,customer_name.ilike.%${q}%`); }
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('work_item_id').range(...bounds(f));
  if (error) throw new DomainError(error.message, 'quotes.list_failed');
  const rows: FinanceQuoteRow[] = (data ?? []).map(r => ({ workItemId: r.work_item_id!, title: r.title!, status: r.status ?? '', customer: r.customer_id ? { id: r.customer_id, name: r.customer_name ?? 'Customer' } : null,
    createdAt: r.created_at!, lineCount: r.line_count ?? 0, quoted: r.total_minor === null ? null : { totalMinor: safeMinor(r.total_minor), currency: r.currency! }, invoiced: r.invoiced ?? false }));
  return { rows, total: count ?? 0 };
}

export async function readFinancePayments(db: Db, organizationId: string, f: FinanceFilter = {}) {
  let query = db.from('finance_payment_records').select('*', { count: 'exact' }).eq('organization_id', organizationId);
  if (f.customer) query = query.eq('customer_id', f.customer);
  if (f.from) query = query.gte('received_at', f.from);
  if (f.to) query = query.lt('received_at', f.to);
  if (f.q && searchTerm(f.q)) { const q = searchTerm(f.q); query = /^#?\d+$/.test(f.q.trim()) ? query.eq('invoice_number', Number(f.q.replace('#', ''))) : query.or(`billed_to.ilike.%${q}%,provider_reference.ilike.%${q}%,note.ilike.%${q}%`); }
  const { data, error, count } = await query.order('received_at', { ascending: false }).order('id').range(...bounds(f));
  if (error) throw new DomainError(error.message, 'payments.list_failed');
  const rows: PaymentRecord[] = (data ?? []).map(r => ({ id: r.id!, invoiceId: r.invoice_id!, invoiceNumber: r.invoice_number!, workItemId: r.work_item_id!, billedTo: r.billed_to!, customerId: r.customer_id,
    amountMinor: safeMinor(r.amount_minor!), currency: r.currency!, receivedAt: r.received_at!, provider: r.provider, providerReference: r.provider_reference, note: r.note }));
  return { rows, total: count ?? 0 };
}
