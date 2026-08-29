import { paymentProvider } from '@/lib/adapters/payments';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { getInvoiceForWorkItem, invoiceStanding } from '@/lib/domain/billing/invoices';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';

/**
 * Asking a processor for money, and writing down what it says arrived.
 *
 * **This module names a capability and never a provider** (I15). It imports
 * `@/lib/adapters/payments`, which is an interface; it does not import `./stripe`, does not
 * know a session from an intent, and would need no edit if a second processor landed.
 * `adapters.test.ts` asserts that from the tree rather than trusting the sentence.
 *
 * **Only the asking half is here, and the split is D2's.** Asking is an ordinary domain write
 * under the caller's own JWT with `payment.record` behind it. *Being told* is webhook ingress —
 * no human caller at all — and it lives in `apps/api`, which reaches the same database through
 * a Postgres role holding one `execute` and no table grant anywhere. See `constraints.md` D26,
 * and `20260829000008_payment_provider.sql` for the role.
 */

/** What a payer needs, and what we remembered about having asked. */
export type CardPaymentRequest = {
  requestId: string;
  payUrl: string;
};

/**
 * Ask the processor to collect what is still owed on an invoice.
 *
 * **The amount is not an argument**, for the reason that runs through every money path here: it
 * is `invoiceStanding`'s outstanding figure, which is `priceWorkItem` over the invoice's own
 * lines minus what has arrived (I4). A caller that could name an amount could ask a customer
 * for a number nothing in this system stands behind.
 *
 * `null` when this deployment has no processor configured. A business that takes only cash is
 * a complete business, and the screen shows no card option rather than an error.
 */
export async function requestCardPayment(
  db: Db,
  input: { organizationId: string; workItemId: string; returnUrl: string },
): Promise<CardPaymentRequest | null> {
  const actor = await requireActor(db);

  // Two different absences, and both are `null` on purpose. The deployment may have no
  // processor configured at all, or this business may not have switched card payments on —
  // the operator sees no card control either way, and telling the two apart on screen would
  // ask them to fix something that is not theirs to fix.
  const [provider, enabled] = await Promise.all([
    paymentProvider(),
    listEnabledModules(db, { organizationId: input.organizationId }),
  ]);
  if (!provider || !enabled.has('card_payments')) return null;

  // **Whose account the money lands in, and there is no fallback.** A business that has not
  // connected one cannot take a card, and the alternative — charging on the platform's own
  // account "for now" — is the money-transmitter shape D27 refuses. Null rather than a throw,
  // for the same reason the two absences above are: the operator sees no card control, and
  // the settings screen is where they are told what to do about it.
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
    // Settled, or unpriced. Asking for nothing is not a payment request, and asking for a
    // negative is asking the customer to invoice us.
    throw new DomainError(
      'Nothing is outstanding on that invoice.',
      'card_payments.nothing_outstanding',
    );
  }

  // Our row first, so the correlation token exists before the processor is told anything. The
  // reverse order would mean a session live in the world with nothing here that knows about it.
  //
  // The id is generated here rather than by the default, because it is also the placeholder
  // `provider_reference` until the processor supplies its own. A literal like `'pending'` was
  // the first draft and is wrong: `(organization_id, provider, provider_reference)` is unique,
  // so a business with two payments in flight at once would have had the second refused.
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
      // The business's own words: the invoice says who it is to and what number it is. No
      // platform noun reaches a payer's card statement.
      description: `Invoice #${invoice.number}`,
      returnUrl: input.returnUrl,
    });
  } catch {
    // Deliberately not deleted. The row records that this business asked, the attempt failed,
    // and nothing was collected — which is a truer history than a gap, and it is what makes a
    // repeated failure visible instead of silent.
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
