import type { Db } from '@/lib/db/types';
import { listOrganizationPayments, type PaymentRecord } from '@/lib/domain/billing/invoices';

/** A recorded payment, as `payments` holds it. A null `provider` means a person wrote it down; no method is inferred beyond that. */
export type FinancePayments = {
  rows: PaymentRecord[];
  total: number;
};

export async function loadFinancePayments(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<FinancePayments> {
  const payments = await listOrganizationPayments(db, input);
  return { rows: [...payments], total: payments.total };
}

/** Received per currency. A refund or correction is a negative row, so this is net of what was recorded. */
export function receivedByCurrency(rows: PaymentRecord[]): { currency: string; receivedMinor: number }[] {
  const byCurrency = new Map<string, number>();
  for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amountMinor);
  return [...byCurrency.entries()]
    .map(([currency, receivedMinor]) => ({ currency, receivedMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
