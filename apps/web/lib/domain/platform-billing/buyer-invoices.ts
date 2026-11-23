import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';

/**
 * The invoices GildOps addressed to one business it serves, as that business reads them in
 * Settings → Plan & usage (ADR-057, ADR-051's buyer-side view). A buyer-only projection
 * (`platform_invoices_for_buyer`): what is owed and paid, the period and the provider's page to pay
 * it — never GildOps' invoice records, other customers' invoices or anything GildOps' costs.
 * Answered only for the business's own billing managers.
 */
export type BuyerInvoice = {
  id: string;
  number: string;
  issuedAt: string;
  dueAt: string | null;
  periodStart: string | null;
  /** The last day the invoice bills (the stored period end is the first day after it). */
  periodLastDay: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  state: 'outstanding' | 'paid' | 'void';
  payUrl: string | null;
};

export async function listPlatformInvoicesForBuyer(db: Db, input: { organizationId: string }): Promise<BuyerInvoice[]> {
  const { data, error } = await db.rpc('platform_invoices_for_buyer', { p_organization_id: input.organizationId });
  if (error) throw fromDatabaseError(error, 'plan_usage.invoices_failed');
  return (data ?? []).map((row) => {
    const totalMinor = Number(row.total_minor);
    const paidMinor = Number(row.paid_minor);
    return {
      id: row.id,
      number: row.number,
      issuedAt: row.issued_at,
      dueAt: row.due_at,
      periodStart: row.period_start,
      periodLastDay: row.period_end ? new Date(Date.parse(`${row.period_end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : null,
      currency: row.currency,
      totalMinor,
      paidMinor,
      state: row.voided ? 'void' : paidMinor >= totalMinor ? 'paid' : 'outstanding',
      payUrl: row.pay_url,
    };
  });
}
