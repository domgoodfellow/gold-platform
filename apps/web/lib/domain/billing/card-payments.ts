import { paymentProvider } from '@/lib/adapters/payments';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { getInvoiceForWorkItem, invoiceStanding } from '@/lib/domain/billing/invoices';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';

/**
 * Asking a processor for money, and writing down what it says arrived. Only the asking half is
 * here — asking is an ordinary write under the caller's own JWT; being told is webhook ingress
 * with no human caller, which lives in `apps/api` under its own Postgres role with no table
 * grant (D2, D26).
 */

export type CardPaymentRequest = {
  requestId: string;
  payUrl: string;
};

/**
 * Ask the processor to collect what is still owed on an invoice. The amount is never an
 * argument — it's `invoiceStanding`'s outstanding figure (I4), so a caller can't ask a customer
 * for a number nothing here stands behind. Null when this deployment has no processor
 * configured — a cash-only business is complete, and the screen shows no card option.
 */
export async function requestCardPayment(
  db: Db,
  input: { organizationId: string; workItemId: string; returnUrl: string },
): Promise<CardPaymentRequest | null> {
  const actor = await requireActor(db);

  // Two different absences, both null on purpose: no processor configured at all, or this
  // business hasn't switched card payments on. Either way the operator just sees no control.
  const [provider, enabled] = await Promise.all([
    paymentProvider(),
    listEnabledModules(db, { organizationId: input.organizationId }),
  ]);
  if (!provider || !enabled.has('card_payments')) return null;

  // No fallback account — charging on the platform's own account "for now" is the
  // money-transmitter shape D27 refuses.
  const connected = await getPaymentAccount(db, {
    organizationId: input.organizationId,
    provider: provider.name,
  });
  if (!connected) return null;

  const invoice = await getInvoiceForWorkItem(db, {
    organizationId: input.organizationId,
    workItemId: input.workItemId,
  });
  if (!invoice) {
    throw new DomainError('There is no invoice to collect.', 'card_payments.no_invoice');
  }

  const standing = invoiceStanding(invoice);
  if (standing.outstandingMinor === null || standing.outstandingMinor <= 0) {
    throw new DomainError(
      'Nothing is outstanding on that invoice.',
      'card_payments.nothing_outstanding',
    );
  }

  // Our row first, so the correlation token exists before the processor is told anything. The
  // id doubles as the placeholder `provider_reference` until the processor supplies its own —
  // a literal like `'pending'` would collide on the (organization, provider, reference) unique
  // constraint for a business with two payments in flight at once.
  const requestId = crypto.randomUUID();

  const { error } = await db.from('payment_requests').insert({
    id: requestId,
    organization_id: input.organizationId,
    invoice_id: invoice.id,
    provider: provider.name,
    provider_reference: requestId,
    amount_minor: standing.outstandingMinor,
    currency: invoice.currency,
    created_by: actor.id,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot take payments here.', 'card_payments.forbidden');
    }
    throw new DomainError(error.message, 'card_payments.request_failed');
  }

  let requested;
  try {
    requested = await provider.request({
      account: connected.account,
      requestId,
      amountMinor: standing.outstandingMinor,
      currency: invoice.currency,
      description: `Invoice #${invoice.number}`,
      returnUrl: input.returnUrl,
    });
  } catch {
    // Deliberately not deleted — the row records that this business asked and the attempt failed,
    // which is truer history than a gap and makes a repeated failure visible.
    throw new DomainError(
      'The payment provider would not take that request.',
      'card_payments.provider_refused',
    );
  }

  const { error: referenceError } = await db
    .from('payment_requests')
    .update({ provider_reference: requested.providerReference })
    .eq('id', requestId);

  if (referenceError) {
    throw new DomainError(referenceError.message, 'card_payments.reference_failed');
  }

  return { requestId, payUrl: requested.payUrl };
}
