import type { Db } from '@/lib/db/types';
import { paymentProvider } from '@/lib/adapters/payments';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { readFinanceActivity, readFinanceInvoices, readFinancePayments, readFinanceQuotes, readFinanceSummary, type CurrencyAmount, type FinanceFilter, type FinanceSummary } from '@/lib/domain/billing/finance-reads';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listInvoicedAndIncurred, totalsByCurrency } from '@/lib/domain/reporting/financials';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { shiftDate, shiftMonth, startOfMonth, todayInZone, zonedTimeToInstant, zonedDayRange } from '@/lib/domain/scheduling/window';

export function financePeriod(today: string, raw?: string) {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw ?? '') && Number(raw?.slice(0,4)) >= 100 && Number(raw?.slice(0,4)) < 9999 ? `${raw}-01` : startOfMonth(today);
  return { from: month, to: shiftMonth(month, 1), month: month.slice(0, 7) };
}

/** Unpaid and due from now to the end of the `DUE_SOON_DAYS`th day ahead — so never also overdue. */
export function dueSoonWindow(timezone: string, now: Date = new Date()) {
  return { dueFrom: now.toISOString(), dueTo: zonedDayRange(shiftDate(todayInZone(timezone, now), DUE_SOON_DAYS), timezone).endsAt };
}

export function financeFilters(params: Record<string, string | string[] | undefined>, timezone: string, now: Date = new Date()): FinanceFilter {
  const text = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const date = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(text(key)) && Number.isFinite(Date.parse(text(key))) && new Date(text(key)).toISOString().slice(0,10) === text(key) ? zonedTimeToInstant(text(key), '00:00', timezone) : undefined;
  const choice = (key: string, allowed: readonly string[]) => allowed.includes(text(key)) ? text(key) : undefined;
  // `due-soon` is the Dashboard's window, so its count and this view's always agree; an explicit Due on date narrows it.
  const soon = text('status') === 'due-soon';
  const due = date('due') ? zonedDayRange(text('due'), timezone) : soon ? { startsAt: dueSoonWindow(timezone, now).dueFrom, endsAt: dueSoonWindow(timezone, now).dueTo } : undefined;
  return { q: text('q').slice(0, 100), status: soon ? 'outstanding' : text('status'), customer: /^[0-9a-f-]{36}$/.test(text('customer')) ? text('customer') : undefined,
    from: date('from'), to: date('to'), dueFrom: due?.startsAt, dueTo: due?.endsAt, page: Math.min(100000, Math.max(1, Math.floor(Number(text('page')) || 1))),
    sort: text('sort').slice(0, 20) || undefined, entry: choice('entry', ['receipts', 'corrections']), source: choice('source', ['manual', 'processor']) };
}

/** Days ahead, after today, that an unpaid invoice counts as due soon. */
export const DUE_SOON_DAYS = 7;
const PAST_DUE_BANDS = new Set(['1–30 days', '31–60 days', '61–90 days', '90+ days']);

/**
 * What is past due, per currency — the receivables aging bands beyond "Not yet due", so it is the
 * same money `finance_dashboard_summary` already reports, never a second calculation, and never
 * one figure across currencies.
 */
export function overdueByCurrency(aging: FinanceSummary['aging']): CurrencyAmount[] {
  const totals = new Map<string, bigint>();
  for (const band of aging) if (PAST_DUE_BANDS.has(band.band)) totals.set(band.currency, (totals.get(band.currency) ?? BigInt(0)) + BigInt(band.amount));
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount: amount.toString(), count: 0 }));
}

/**
 * Whether card collection needs a person's attention. A business that records payments by hand is
 * not misconfigured, so `off` and `connected` raise nothing; only an enabled card module with no
 * processor in this deployment, or no account connected to it, does.
 */
export type CardCollection = 'off' | 'connected' | 'not-connected' | 'unavailable';

/**
 * The Finance Dashboard's model. Exact counts come from the database; amounts come from the
 * reporting summary and so exist only for `report.read`. Overdue and due-soon never share an
 * invoice: overdue is unpaid past its due time, due soon is unpaid and due from now to the end of
 * the seventh day ahead. Priced Work waiting for an invoice is a different record, not a debt.
 */
export async function loadFinanceOperating(db: Db, input: { organizationId: string; today: string; timezone: string; month?: string; canReadReports: boolean; now?: Date }) {
  const period = financePeriod(input.today, input.month);
  const now = input.now ?? new Date();
  const soon = dueSoonWindow(input.timezone, now);
  const [invoiced, priced, open, overdue, dueSoon, quotes, payments, activity, enabled, priceBook, summary, financials] = await Promise.all([
    readFinanceInvoices(db, input.organizationId, { limit: 1 }),
    readFinanceQuotes(db, input.organizationId, { limit: 1 }),
    readFinanceInvoices(db, input.organizationId, { status: 'outstanding', limit: 1 }),
    readFinanceInvoices(db, input.organizationId, { status: 'overdue', sort: 'due', limit: 5 }),
    readFinanceInvoices(db, input.organizationId, { status: 'outstanding', ...soon, sort: 'due', limit: 5 }),
    readFinanceQuotes(db, input.organizationId, { status: 'not-invoiced', limit: 5 }),
    readFinancePayments(db, input.organizationId, { limit: 1 }),
    readFinanceActivity(db, input.organizationId, 6),
    listUsableModules(db, { organizationId: input.organizationId }),
    listPriceBookItems(db, { organizationId: input.organizationId }),
    input.canReadReports ? readFinanceSummary(db, input.organizationId, period.from, period.to) : null,
    input.canReadReports ? listInvoicedAndIncurred(db, { organizationId: input.organizationId, grouping: 'customer', period }) : null,
  ]);
  let cardCollection: CardCollection = 'off';
  if (enabled.has('card_payments')) {
    const provider = await paymentProvider();
    cardCollection = !provider ? 'unavailable' : (await getPaymentAccount(db, { organizationId: input.organizationId, provider: provider.name })) ? 'connected' : 'not-connected';
  }
  return {
    period, open, overdue, dueSoon, quotes, payments, activity, summary,
    overdueAmounts: summary ? overdueByCurrency(summary.aging) : null,
    priceBookCount: priceBook.length,
    /** No priced Work, invoice or payment yet: the Dashboard offers a starting path instead of zero-valued figures. */
    started: invoiced.total > 0 || priced.total > 0 || payments.total > 0,
    billingEnabled: enabled.has('billing'), cardCollection,
    financials: financials ? totalsByCurrency(financials) : null,
    /** The customer rows behind `financials`, for the Dashboard's invoiced-and-costs chart (same read, not a second query). */
    financialGroups: financials,
    /** Exact count of every issued invoice. */
    issuedCount: invoiced.total,
  };
}
export type FinanceOperating = Awaited<ReturnType<typeof loadFinanceOperating>>;
