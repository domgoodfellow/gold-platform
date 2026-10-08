import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
export type CurrencyTotal = { currency: string; amount_minor: string };
export type CrmSummary = { customers: number; open: number; today: number; overdue: number; noNext: number; unassigned: number;
  forecast: CurrencyTotal[]; pipeline: CurrencyTotal[]; won: number; lost: number };
export async function crmDashboardSummary(db: Db, organizationId: string, month: string): Promise<CrmSummary> {
  const { data, error } = await db.rpc('crm_dashboard_summary', { p_organization_id: organizationId, p_month: month });
  if (error) throw new DomainError(error.message, 'crm.summary_failed');
  return data as unknown as CrmSummary;
}
export function winRate(won: number, lost: number): number | null { return won + lost ? won / (won + lost) : null; }
