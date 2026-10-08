import type { Db } from '@/lib/db/types';
import { readFinanceActivity, readFinanceInvoices, readFinancePayments, readFinanceQuotes, readFinanceSummary, type FinanceFilter } from '@/lib/domain/billing/finance-reads';
import { listInvoicedAndIncurred, totalsByCurrency } from '@/lib/domain/reporting/financials';
import { listUsableModules, outstandingModuleSetup } from '@/lib/domain/tenancy/modules';
import { shiftMonth, startOfMonth, zonedTimeToInstant, zonedDayRange } from '@/lib/domain/scheduling/window';

export function financePeriod(today: string, raw?: string) {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw ?? '') && Number(raw?.slice(0,4)) >= 100 && Number(raw?.slice(0,4)) < 9999 ? `${raw}-01` : startOfMonth(today);
  return { from: month, to: shiftMonth(month, 1), month: month.slice(0, 7) };
}

export function financeFilters(params: Record<string, string | string[] | undefined>, timezone: string): FinanceFilter {
  const text = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const date = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(text(key)) && Number.isFinite(Date.parse(text(key))) && new Date(text(key)).toISOString().slice(0,10) === text(key) ? zonedTimeToInstant(text(key), '00:00', timezone) : undefined;
  const due = date('due') ? zonedDayRange(text('due'), timezone) : undefined;
  return { q: text('q').slice(0, 100), status: text('status'), customer: /^[0-9a-f-]{36}$/.test(text('customer')) ? text('customer') : undefined,
    from: date('from'), to: date('to'), dueFrom: due?.startsAt, dueTo: due?.endsAt, page: Math.min(100000, Math.max(1, Math.floor(Number(text('page')) || 1))) };
}

export async function loadFinanceOperating(db: Db, input: { organizationId: string; today: string; timezone: string; month?: string; canReadReports: boolean }) {
  const period = financePeriod(input.today, input.month);
  const day = zonedDayRange(input.today, input.timezone);
  const [open, overdue, quotes, payments, due, activity, enabled, summary, financials] = await Promise.all([
    readFinanceInvoices(db, input.organizationId, { status: 'outstanding', limit: 7 }),
    readFinanceInvoices(db, input.organizationId, { status: 'overdue', limit: 4 }),
    readFinanceQuotes(db, input.organizationId, { status: 'not-invoiced', limit: 4 }),
    readFinancePayments(db, input.organizationId, { limit: 5 }),
    readFinanceInvoices(db, input.organizationId, { status: 'outstanding', dueFrom: day.startsAt, dueTo: day.endsAt, limit: 5 }),
    readFinanceActivity(db, input.organizationId),
    listUsableModules(db, { organizationId: input.organizationId }),
    input.canReadReports ? readFinanceSummary(db, input.organizationId, period.from, period.to) : null,
    input.canReadReports ? listInvoicedAndIncurred(db, { organizationId: input.organizationId, grouping: 'customer', period }) : null,
  ]);
  const setup = await outstandingModuleSetup(db, { organizationId: input.organizationId, enabled: new Set([...enabled].filter(k => k === 'billing' || k === 'card_payments')) });
  return { period, open, overdue, quotes, payments, due, activity, summary, billingEnabled: enabled.has('billing'), cardPaymentsEnabled: enabled.has('card_payments'), setup: [...setup].map(([module, message]) => ({ module, message })), financials: financials ? totalsByCurrency(financials) : null };
}
export type FinanceOperating = Awaited<ReturnType<typeof loadFinanceOperating>>;
