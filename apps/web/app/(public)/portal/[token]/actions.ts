'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { requestPortalCardPayment } from '@/lib/domain/billing/card-payments';
import { DomainError } from '@/lib/domain/errors';
import { claimPortalInvite } from '@/lib/domain/portal/portal';
import { submitPortalForm } from '@/lib/domain/portal/portal-forms';
import type { PublicFormActionState } from '@/app/(public)/forms/actions';
import { requestOrigin } from '@/lib/route/origin';

export type PayInvoiceActionState = { error: string | null };

/**
 * The customer's own "pay" — never a link handed back for them to send to themselves.
 *
 * **What this submits, and nothing more.** `invoiceId` is the only value the form carries.
 * `requestPortalCardPayment` derives which organization, what is actually outstanding, and which
 * connected account receives it — none of that is a value this action could choose even if the
 * form tried to submit one (D22, D27).
 *
 * **The return URL never carries this page's own token.** Building it here, from
 * `requestOrigin()`, at a route with no token in its path, is deliberate: the token is this
 * portal's credential, and hard-coding a route the browser is about to hand to a third-party
 * processor is not the place to disclose it. See `portal/payment-return/page.tsx`.
 */
export async function payInvoiceAction(
  _previous: PayInvoiceActionState,
  formData: FormData,
): Promise<PayInvoiceActionState> {
  const db = await getDb();
  const invoiceId = String(formData.get('invoiceId') ?? '');

  let requested;
  try {
    requested = await requestPortalCardPayment(db, {
      invoiceId,
      returnUrl: `${await requestOrigin()}/portal/payment-return`,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  if (!requested) {
    return {
      error: 'This payment could not be started right now. Refresh the page and try again.',
    };
  }

  // The one place this platform sends a customer off it — a redirect issued by the caller, not
  // by the domain layer, which only ever hands back a URL (the same division `requestCardPaymentAction`
  // already keeps on the operator side).
  redirect(requested.payUrl);
}

/**
 * A portal customer's form response. `formId` is the only identity-shaped value, and it only chooses
 * among the forms this customer's own portal binding is offered — which business, and which
 * customer the response is about, are read from that binding by the database.
 *
 * **The link's token is presented again here, on purpose.** A page render cannot set a cookie, so
 * the anonymous session the portal page made to read this customer's history lasts for that render
 * only; an action is where a session can be kept. Presenting the same credential again re-makes the
 * same binding (`claim_portal_invite` is idempotent for one business) and leaves a session behind
 * for the next action. It is the same trust the link already carried, not a new one.
 */
export async function submitPortalFormAction(input: {
  token: string;
  formId: string;
  answers: Record<string, unknown>;
}): Promise<PublicFormActionState> {
  const db = await getDb();
  try {
    await claimPortalInvite(db, { token: input.token });
  } catch (error) {
    if (error instanceof DomainError) return { status: 'error', message: 'This link is no longer valid.', fieldErrors: {}, stale: false };
    throw error;
  }
  const result = await submitPortalForm(db, { formId: input.formId, answers: input.answers });
  if (result.ok) return { status: 'sent' };
  return { status: 'error', message: result.message, fieldErrors: result.fieldErrors, stale: result.stale };
}
