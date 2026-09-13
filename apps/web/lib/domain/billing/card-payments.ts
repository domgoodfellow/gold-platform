import { paymentProvider, type ConnectedAccount, type PaymentProvider } from '@/lib/adapters/payments';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { getInvoiceForWorkItem, invoiceStanding } from '@/lib/domain/billing/invoices';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listUsableModules } from '@/lib/domain/tenancy/modules';

/**
 * Asking a processor for money, and writing down what it says arrived. Only the asking half is
 * here — asking is an ordinary write under the caller's own JWT; being told is webhook ingress
 * with no human caller, which lives in `apps/api` under its own Postgres role with no table
 * grant (D2, D26).
 *
 * Two callers, one implementation of the actual asking. An operator resolves *their own*
 * organization-authorized invoice and writes `payment_requests` directly, under RLS the
 * `payment.record` capability already grants. A portal visitor resolves nothing themselves —
 * `begin_external_card_payment` (a narrow `SECURITY DEFINER` function, see the migration this
 * shipped in) derives their external scope, re-proves invoice ownership and entitlement, and
 * writes the row on their behalf, since an external actor holds no table grant on
 * `payment_requests` at all and none is added here (I21's shape, restated for a fourth axis).
 * What both share — ask the provider, then correct the row with what it actually said — is
 * `askProviderToCollect` below, so there is exactly one place that talks to a processor.
 */

export type CardPaymentRequest = {
  requestId: string;
  payUrl: string;
};

/**
 * Ask the provider and record its reply. Neither the request's own creation nor how its
 * correction is written back are decided here — both are the caller's own authorization
 * concern, passed in as `confirmReference` — but there is exactly one place this repository
 * calls `provider.request`.
 */
async function askProviderToCollect(input: {
  provider: PaymentProvider;
  account: ConnectedAccount;
  requestId: string;
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  confirmReference: (providerReference: string) => Promise<void>;
}): Promise<CardPaymentRequest> {
  let requested;
  try {
    requested = await input.provider.request({
      account: input.account,
      requestId: input.requestId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description,
      returnUrl: input.returnUrl,
    });
  } catch {
    // Deliberately not deleted — the row records that this business asked and the attempt
    // failed, which is truer history than a gap and makes a repeated failure visible.
    throw new DomainError(
      'The payment provider would not take that request.',
      'card_payments.provider_refused',
    );
  }

  await input.confirmReference(requested.providerReference);

  return { requestId: input.requestId, payUrl: requested.payUrl };
}

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
    listUsableModules(db, { organizationId: input.organizationId }),
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

  return askProviderToCollect({
    provider,
    account: connected.account,
    requestId,
    amountMinor: standing.outstandingMinor,
    currency: invoice.currency,
    description: `Invoice #${invoice.number}`,
    returnUrl: input.returnUrl,
    confirmReference: async (providerReference) => {
      const { error: referenceError } = await db
        .from('payment_requests')
        .update({ provider_reference: providerReference })
        .eq('id', requestId);

      if (referenceError) {
        throw new DomainError(referenceError.message, 'card_payments.reference_failed');
      }
    },
  });
}

/**
 * The customer's own door onto the same processor request — D22's external axis, not
 * Organization Context. `begin_external_card_payment` derives everything: which organization,
 * which invoice is genuinely this customer's, what it still stands at, and which connected
 * account receives it. This function accepts none of those from its own caller either — an
 * invoice id and a server-built return URL are the whole of its input.
 *
 * Null covers every reason there might be nothing to offer — no processor configured, card
 * payments not usable, no connected account, or the invoice simply isn't this customer's —
 * indistinguishably, the same shape a 404 already gives a portal visitor elsewhere on this
 * surface. Hiding the reason is not the guard; the database's own scope check is (I12).
 */
export async function requestPortalCardPayment(
  db: Db,
  input: { invoiceId: string; returnUrl: string },
): Promise<CardPaymentRequest | null> {
  await requireActor(db);

  const provider = await paymentProvider();
  if (!provider) return null;

  const { data, error } = await db
    .rpc('begin_external_card_payment', {
      p_invoice_id: input.invoiceId,
      p_provider: provider.name,
    })
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      return null;
    }
    if (error.code === 'GD001') {
      throw new DomainError(
        'That invoice has nothing outstanding.',
        'card_payments.nothing_outstanding',
      );
    }
    throw new DomainError(error.message, 'card_payments.request_failed');
  }
  if (!data) return null;

  return askProviderToCollect({
    provider,
    account: { accountId: data.account_id },
    requestId: data.request_id,
    amountMinor: data.outstanding_minor,
    currency: data.currency,
    // The business's own invoice number never left the operator screen for this path — the RPC
    // hands back only what paying needs, not the row's own metadata — so the payer sees a plain
    // description rather than one this function would have to fetch a second time to build.
    description: 'Outstanding balance',
    returnUrl: input.returnUrl,
    confirmReference: async (providerReference) => {
      const { error: referenceError } = await db.rpc('confirm_external_card_payment', {
        p_request_id: data.request_id,
        p_provider_reference: providerReference,
      });
      if (referenceError) {
        throw new DomainError(referenceError.message, 'card_payments.reference_failed');
      }
    },
  });
}

/**
 * Whether the portal should offer a Pay action on one invoice at all — read-only, so a page may
 * call it on every render without creating anything. A courtesy, never the guard:
 * `requestPortalCardPayment` re-proves every one of these conditions itself rather than trusting
 * that this was called first (I12).
 */
export async function portalCardPaymentAvailable(
  db: Db,
  input: { invoiceId: string },
): Promise<{ outstandingMinor: number; currency: string } | null> {
  const provider = await paymentProvider();
  if (!provider) return null;

  const { data, error } = await db
    .rpc('external_card_payment_availability', {
      p_invoice_id: input.invoiceId,
      p_provider: provider.name,
    })
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'card_payments.availability_failed');
  }
  if (!data) return null;

  return { outstandingMinor: data.outstanding_minor, currency: data.currency };
}
