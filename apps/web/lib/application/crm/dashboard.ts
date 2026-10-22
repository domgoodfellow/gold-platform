import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
export type CurrencyTotal = { currency: string; amount_minor: string };
export type CrmSummary = { lifecycles?: Record<'lead'|'prospect'|'customer'|'unclassified',number>; customers: number; open: number; today: number; overdue: number; noNext: number; unassigned: number;
  forecast: CurrencyTotal[]; pipeline: CurrencyTotal[]; won: number; lost: number };
export async function crmDashboardSummary(db: Db, organizationId: string, month: string): Promise<CrmSummary> {
  const { data, error } = await db.rpc('crm_dashboard_summary', { p_organization_id: organizationId, p_month: month });
  if (error) throw new DomainError(error.message, 'crm.summary_failed');
  const entries = await Promise.all((['lead','prospect','customer','unclassified'] as const).map(async lifecycle => {
    let query = db.from('contacts').select('id', {head:true,count:'exact'}).eq('organization_id',organizationId);
    query = lifecycle === 'unclassified' ? query.is('lifecycle',null) : query.eq('lifecycle',lifecycle);
    const result = await query;
    if (result.error) throw new DomainError(result.error.message,'crm.summary_failed');
    return [lifecycle,result.count ?? 0] as const;
  }));
  return {...data as unknown as CrmSummary,lifecycles:Object.fromEntries(entries) as NonNullable<CrmSummary['lifecycles']>};
}
export function winRate(won: number, lost: number): number | null { return won + lost ? won / (won + lost) : null; }
