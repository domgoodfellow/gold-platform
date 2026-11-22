import type { Db } from '@/lib/db/types';
import { calendarMonthPeriod, organizationRevenueSummary, platformRevenuePortfolio } from '@/lib/domain/commercial/charges';
import { organizationCostToServe } from '@/lib/domain/commercial/infrastructure-costs';
import { listOrganizationInfrastructureCosts } from '@/lib/domain/commercial/infrastructure-costs';
import { organizationAllowanceStates } from '@/lib/domain/commercial/allowances';
import { listTenants } from '@/lib/domain/platform/tenants';

/**
 * GildOps' own portfolio economics for the current calendar month — composed for Finance's
 * Economics screen (Work Order B, B8/B9). Nothing here calculates a second time: every figure is
 * `platform_revenue_portfolio`'s own answer, read once.
 */
export async function loadPortfolioEconomics(db: Db, input: { reportingCurrency?: string } = {}) {
  const period = calendarMonthPeriod();
  const [portfolio, tenants] = await Promise.all([
    platformRevenuePortfolio(db, { billingPeriodStart: period.start, billingPeriodEnd: period.end, reportingCurrency: input.reportingCurrency }),
    listTenants(db),
  ]);
  const organizationById = new Map(tenants.tenants.map((tenant) => [tenant.id, tenant]));
  return { period, portfolio, organizationById, reportingCurrency: input.reportingCurrency ?? 'CAD' };
}

export type PortfolioEconomicsModel = Awaited<ReturnType<typeof loadPortfolioEconomics>>;

/**
 * One organization's revenue, cost-to-serve, margin, storage and infrastructure detail for the
 * current calendar month — the Finance Economics detail screen, and the same read the
 * Commercial Account's own economics projection links out to (section 31: no duplicated
 * calculation).
 */
export async function loadOrganizationEconomics(db: Db, input: { organizationId: string; reportingCurrency?: string }) {
  const period = calendarMonthPeriod();
  const [revenue, cost, infrastructureCosts, storage] = await Promise.all([
    organizationRevenueSummary(db, { organizationId: input.organizationId, billingPeriodStart: period.start, billingPeriodEnd: period.end, reportingCurrency: input.reportingCurrency }),
    organizationCostToServe(db, { organizationId: input.organizationId, periodStart: period.start, periodEnd: period.end, reportingCurrency: input.reportingCurrency }),
    listOrganizationInfrastructureCosts(db, { organizationId: input.organizationId, from: period.start.slice(0, 10), to: period.end.slice(0, 10) }),
    organizationAllowanceStates(db, { organizationId: input.organizationId, allowanceKey: 'storage_bytes' }),
  ]);
  return { period, revenue, cost, infrastructureCosts, storage: storage[0] ?? null };
}

export type OrganizationEconomicsModel = Awaited<ReturnType<typeof loadOrganizationEconomics>>;
