'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { publicPlanCatalog } from '@/lib/domain/catalogue/public-catalog';
import { choosePlatformPlan, selfServeCurrencies, selfServePrice } from '@/lib/domain/platform-billing/self-serve';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { clearChosenPlan, parseChosenPlan } from '@/lib/route/chosen-plan';

export type CreateBusinessState = { error: string | null };

/**
 * Make a business, then offer it a starting point: the review screen with no draft waiting shows
 * the published templates and "Start blank". Choosing one opens it as a draft to review; nothing
 * is applied until the owner applies it, and Start blank goes to Setup as before.
 *
 * A plan chosen on Pricing travels with the form. It is checked before anything is created, so a
 * currency the plan is not sold in is corrected on this form rather than leaving a business with
 * no plan; once the business exists it is put on the plan.
 */
export async function createBusinessAction(
  _previous: CreateBusinessState,
  formData: FormData,
): Promise<CreateBusinessState> {
  const db = await getDb();
  const currency = String(formData.get('currency') ?? '') || undefined;
  const chosen = parseChosenPlan(formData.get('planKey'), formData.get('billingInterval'));

  if (chosen) {
    const plan = (await publicPlanCatalog(db)).find((entry) => entry.key === chosen.planKey && entry.kind === 'plan');
    if (!plan || plan.requiresContactSales) {
      await clearChosenPlan();
      return { error: 'That plan is no longer offered. Choose another on Pricing.' };
    }
    if (!selfServePrice(plan, currency, chosen.billingInterval)) {
      const sold = selfServeCurrencies(plan, chosen.billingInterval);
      return {
        error: sold.length > 0
          ? `${plan.label} is sold in ${sold.join(' or ')}. Choose ${sold.length === 1 ? 'it' : 'one'} as the currency.`
          : `${plan.label} is not sold ${chosen.billingInterval === 'year' ? 'yearly' : 'monthly'}. Choose another on Pricing.`,
      };
    }
  }

  let organizationId: string;

  try {
    organizationId = await createOrganization(db, {
      name: String(formData.get('name') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      timezone: String(formData.get('timezone') ?? ''),
      // The currency the form showed for confirmation. Empty when the founder chose to decide later; the pricing screen asks when an amount is first written.
      currency,
      location: {
        countryCode: String(formData.get('countryCode') ?? ''),
        region: String(formData.get('region') ?? ''),
        city: String(formData.get('city') ?? ''),
        postalCode: String(formData.get('postalCode') ?? ''),
        industry: String(formData.get('industry') ?? ''),
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  let destination = `/organizations/${organizationId}/setup/proposal`;
  if (chosen) {
    try {
      await choosePlatformPlan(db, { organizationId, ...chosen });
      await clearChosenPlan();
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      // The business exists; Plan & usage shows that it has no plan yet, and what to do.
      destination = `/organizations/${organizationId}/settings/plan`;
    }
  }

  // Outside the try — `redirect` works by throwing, so catching around it would turn success into an error.
  redirect(destination);
}
