import { cookies } from 'next/headers';

/**
 * The GildOps plan a visitor chose on the pricing page, carried through sign-up, email
 * verification and Google sign-in to the screen that founds their business. It is a preference,
 * not an authority: the business is put on the plan by `choose_platform_plan`, which checks the
 * plan is listed and priced, and payment is still required before launch.
 */
const COOKIE_NAME = 'gold.chosen-plan';
const MAX_AGE_SECONDS = 24 * 60 * 60;
const PLAN_KEY = /^[a-z][a-z0-9_]{1,60}$/;

export type BillingInterval = 'month' | 'year';
export type ChosenPlan = { planKey: string; billingInterval: BillingInterval };

export function parseChosenPlan(planKey: unknown, billingInterval: unknown): ChosenPlan | null {
  if (typeof planKey !== 'string' || !PLAN_KEY.test(planKey)) return null;
  return { planKey, billingInterval: billingInterval === 'year' ? 'year' : 'month' };
}

export async function storeChosenPlan(choice: ChosenPlan): Promise<void> {
  (await cookies()).set(COOKIE_NAME, `${choice.planKey}:${choice.billingInterval}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

export async function readChosenPlan(): Promise<ChosenPlan | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return null;
  const [planKey, billingInterval] = value.split(':');
  return parseChosenPlan(planKey, billingInterval);
}

/** Cleared once a business has been put on it, or when the person founds a business without it. */
export async function clearChosenPlan(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
