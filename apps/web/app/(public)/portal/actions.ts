'use server';

import { redirect } from 'next/navigation';
import { getPortalDb } from '@/lib/db/portal-server';
import { requestPortalCardPayment } from '@/lib/domain/billing/card-payments';
import { DomainError } from '@/lib/domain/errors';
import { requirePortalRequestContext } from '@/lib/domain/portal/request-context';
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
 * **The return URL carries no secret.** Building it here, from
 * `requestOrigin()`, at a route with no token in its path, is deliberate: the token is this
 * portal's credential, and hard-coding a route the browser is about to hand to a third-party
 * processor is not the place to disclose it. See `portal/payment-return/page.tsx`.
 */
export async function payInvoiceAction(
  _previous: PayInvoiceActionState,
  formData: FormData,
): Promise<PayInvoiceActionState> {
  const db = await getPortalDb();
  const invoiceId = String(formData.get('invoiceId') ?? '');

  let requested;
  try {
    await requirePortalRequestContext(db);
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
 * A portal customer's form response. `formId` chooses an offered Form and `revisionId` identifies
 * the published version the customer opened. Which business, and which
 * customer the response is about, are read from that session by the database.
 */
export async function submitPortalFormAction(input: {
  formId: string;
  revisionId: string;
  answers: Record<string, unknown>;
}): Promise<PublicFormActionState> {
  const db = await getPortalDb();
  try {
    await requirePortalRequestContext(db);
  } catch (error) {
    if (error instanceof DomainError) return { status: 'error', message: error.message, fieldErrors: {}, stale: false };
    throw error;
  }
  if (typeof input.revisionId !== 'string') return { status: 'error', message: 'Reload this Form before submitting.', fieldErrors: {}, stale: true };
  const result = await submitPortalForm(db, { formId: input.formId, revisionId: input.revisionId, answers: input.answers });
  if (result.ok) return { status: 'sent' };
  return { status: 'error', message: result.message, fieldErrors: result.fieldErrors, stale: result.stale };
}
