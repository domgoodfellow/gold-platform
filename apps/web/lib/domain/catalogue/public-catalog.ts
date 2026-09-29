import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * The one public-safe read of the commercial catalogue (F1, section 13): active, billable Plans
 * and Add-ons only, standard approved prices only. Backed by `public.public_plan_catalog()`,
 * which never selects a cost, margin or provider column, so there is nothing here to withhold at
 * this layer -- the database already did that. Every future public-facing consumer (Pricing,
 * signup package selection, Studio's eventual commercial handoff) should read through this
 * function rather than querying `platform_plans`/`platform_plan_prices` directly, so there is
 * exactly one definition of "what could I buy" outside this organization's own settings.
 *
 * Distinct from `organization-plans.ts`'s `organizationPlanPrice`/`organizationEffectiveQuotas`,
 * which answer for one specific, already-subscribed organization and may reflect a negotiated
 * agreement or override this projection never sees.
 */

export type PublicPlanPrice = {
  currency: string;
  amountMinor: number;
  billingInterval: 'month' | 'year' | 'one_time';
};

export type PublicPlanProduct = {
  key: string;
  label: string;
};

export type PublicPlanQuota = {
  allowanceKey: string;
  label: string;
  unit: string;
  includedQuantity: number;
  period: string;
  overagePolicy: string;
};

export type PublicPlan = {
  key: string;
  kind: 'plan' | 'addon';
  label: string;
  description: string;
  /** True when this Plan/Add-on has no approved standard price -- render "Contact Sales", not a price. */
  requiresContactSales: boolean;
  prices: PublicPlanPrice[];
  products: PublicPlanProduct[];
  quotas: PublicPlanQuota[];
};

export async function publicPlanCatalog(db: Db): Promise<PublicPlan[]> {
  const { data, error } = await db.rpc('public_plan_catalog');
  if (error) throw new DomainError(error.message, 'public_catalog.plans_failed');
  return (data ?? []).map((row) => ({
    key: row.plan_key,
    kind: row.kind as PublicPlan['kind'],
    label: row.label,
    description: row.description,
    requiresContactSales: row.requires_contact_sales,
    prices: (row.prices as unknown as PublicPlanPrice[]) ?? [],
    products: (row.products as unknown as PublicPlanProduct[]) ?? [],
    quotas: (row.quotas as unknown as PublicPlanQuota[]) ?? [],
  }));
}
