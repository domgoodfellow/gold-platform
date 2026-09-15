'use server';

import { redirect } from 'next/navigation';
import { PlatformBillingCheckoutSchema } from '@gold/schemas';
import { DomainError } from '@/lib/domain/errors';
import { beginPlatformBillingCheckout } from '@/lib/domain/platform-billing/checkout';
import { beginPlatformBillingPortalSession } from '@/lib/domain/platform-billing/portal';
import { requireOrganization } from '@/lib/route/organization';
import { requestOrigin } from '@/lib/route/origin';

export type PlatformBillingActionState = { error: string | null };

/**
 * Start a GOLD subscription. Everything Stripe needs to know is resolved server-side from
 * `organizationId` and a Plan key — never a price or customer id the form could otherwise carry
 * (Phase 7, Phase 15). `redirect()` on success leaves no state to return; a thrown `DomainError`
 * is the only path that does.
 */
export async function beginPlatformBillingCheckoutAction(
  _previous: PlatformBillingActionState,
  formData: FormData,
): Promise<PlatformBillingActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const planKey = String(formData.get('planKey') ?? '');

  const parsed = PlatformBillingCheckoutSchema.safeParse({ organizationId, planKey });
  if (!parsed.success) return { error: 'Choose a Plan to subscribe to.' };

  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.currency) {
    return { error: 'Set this business’s currency in General settings before subscribing.' };
  }

  const origin = await requestOrigin();

  let url: string;
  try {
    ({ url } = await beginPlatformBillingCheckout(db, {
      organizationId,
      planKey: parsed.data.planKey,
      organizationName: organization.name,
      // Nothing a business has not said is filled in on its behalf — a billing contact email is
      // a later, explicit question, not one this checkout invents an answer to.
      organizationEmail: null,
      currency: organization.currency,
      successUrl: `${origin}/organizations/${organizationId}/settings/plan?checkout=success`,
      cancelUrl: `${origin}/organizations/${organizationId}/settings/plan?checkout=canceled`,
    }));
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  redirect(url);
}

export async function beginPlatformBillingPortalAction(
  _previous: PlatformBillingActionState,
  formData: FormData,
): Promise<PlatformBillingActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
  const origin = await requestOrigin();

  let url: string | undefined;
  try {
    const started = await beginPlatformBillingPortalSession(db, {
      organizationId,
      returnUrl: `${origin}/organizations/${organizationId}/settings/plan`,
    });
    url = started?.url;
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  if (!url) return { error: 'There is no subscription to manage yet.' };
  redirect(url);
}
