import Link from 'next/link';
import type { Metadata } from 'next';
import { ButtonLink } from '@/components/controls/button';
import { MarketingPage, MarketingSection } from '@/components/marketing/marketing-page';
import { CtaBand } from '@/features/marketing-site/closing';
import { getPublicDb } from '@/lib/db/public';
import { publicPlanCatalog, type PublicPlan, type PublicPlanQuota } from '@/lib/domain/catalogue/public-catalog';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { consultationHref, offeringById, planIncludesOffering } from '@/lib/marketing/content';

export const metadata: Metadata = {
  title: 'Pricing · GildOps',
  description: 'GildOps plans and prices. Choose one and start today.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing · GildOps',
    description: 'GildOps plans and prices. Choose one and start today.',
    url: '/pricing',
  },
};

type Interval = 'month';

/**
 * GildOps' plans and add-ons as its Finance prices them: `public_plan_catalog` reads the list
 * prices in force on each plan's Catalog & Pricing item, so this page cannot disagree with what a
 * business is charged. A plan with a price is started here; one priced by agreement is talked
 * through. `?product=` narrows the plans to those that include a product page's product.
 */
export default async function PricingPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const query = await searchParams;
  const catalog = await publicPlanCatalog(getPublicDb());
  // Plans are started monthly: the checkout charges monthly.
  const interval: Interval = 'month';
  const offering = query.product ? offeringById(query.product) : undefined;

  const plans = catalog.filter((plan) => plan.kind === 'plan' && (!offering || planIncludesOffering(plan, offering)));
  const addons = catalog.filter((plan) => plan.kind === 'addon' && !plan.requiresContactSales);

  return (
    <MarketingPage>
      <MarketingSection kind="hero">
        <div className="flex flex-col gap-4">
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
            {offering ? `Plans with ${offering.inSentence}` : 'Choose a plan and start today.'}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            Describe your business when you sign up and GildOps drafts your setup for you to check. You pay before you go live.
          </p>
          {offering ? (
            <Link href="/pricing" className="w-fit text-sm text-muted underline underline-offset-4 hover:text-foreground">See every plan</Link>
          ) : null}
        </div>
      </MarketingSection>

      <MarketingSection kind="content">
        {plans.length === 0 ? (
          <p className="max-w-xl text-muted">
            No plan is sold on its own for this yet. <Link href={consultationHref(offering)} className="underline underline-offset-4">Talk to us</Link>.
          </p>
        ) : (
          <ol className="grid gap-x-8 gap-y-12 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => <PlanColumn key={plan.key} plan={plan} interval={interval} />)}
          </ol>
        )}
      </MarketingSection>

      {addons.length > 0 ? (
        <MarketingSection kind="content">
          <section>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Add-ons</h2>
            <ul className="mt-6 divide-y divide-border border-y border-border">
              {addons.map((addon) => {
                const price = addon.prices.find((entry) => entry.billingInterval === interval)
                  ?? addon.prices.find((entry) => entry.billingInterval === 'one_time')
                  ?? addon.prices[0];
                return (
                  <li key={addon.key} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                    <span className="font-medium">{addon.label}</span>
                    {price ? (
                      <span className="text-sm tabular-nums text-muted">
                        {formatMoney(price.amountMinor, price.currency)} {intervalWords(price.billingInterval)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </MarketingSection>
      ) : null}

      <CtaBand
        heading="Rather talk it through first?"
        body="Tell us how you run today and we’ll say which plan fits, or agree one with you."
        primaryHref={consultationHref(offering)}
        primaryLabel="Talk to us"
      />
    </MarketingPage>
  );
}

function PlanColumn({ plan, interval }: { plan: PublicPlan; interval: Interval }) {
  const price = plan.prices.find((entry) => entry.billingInterval === interval);
  const startable = !plan.requiresContactSales && price;
  return (
    <li className="flex flex-col gap-5 border-t-2 border-foreground pt-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{plan.label}</h2>
        {plan.description ? <p className="text-sm leading-relaxed text-muted">{plan.description}</p> : null}
      </div>
      <p className="text-3xl font-semibold tabular-nums">
        {price ? (
          <>
            {formatMoney(price.amountMinor, price.currency)}
            <span className="ms-1 text-base font-normal text-muted">{intervalWords(interval)}</span>
          </>
        ) : (
          <span className="text-xl">Priced with you</span>
        )}
      </p>
      {startable ? (
        <ButtonLink href={`/start?plan=${plan.key}`} tone="primary" className="w-full sm:w-fit">Start with {plan.label}</ButtonLink>
      ) : (
        <ButtonLink href="/demo" tone="secondary" className="w-full sm:w-fit">Talk to us</ButtonLink>
      )}
      {plan.products.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {plan.products.map((product) => <li key={product.key}>{product.label}</li>)}
        </ul>
      ) : null}
      {plan.quotas.length > 0 ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          {plan.quotas.map((quota) => (
            <div key={quota.allowanceKey} className="contents">
              <dt className="text-muted">{quota.label}</dt>
              <dd className="text-end tabular-nums">{quantityWords(quota)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

function intervalWords(interval: string): string {
  if (interval === 'year') return 'a year';
  if (interval === 'one_time') return 'once';
  return 'a month';
}

function quantityWords(quota: PublicPlanQuota): string {
  const amount = quota.unit === 'byte'
    ? `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(quota.includedQuantity / 1e9)} GB`
    : new Intl.NumberFormat('en-GB').format(quota.includedQuantity);
  return quota.period === 'month' ? `${amount} a month` : amount;
}
