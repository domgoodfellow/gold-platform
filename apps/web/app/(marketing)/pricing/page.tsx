import type { Metadata } from 'next';
import { CtaBand } from '@/components/marketing/cta-band';
import { PRICING_PACKAGES, PRICING_FACTORS } from '@/lib/marketing/content';

export const metadata: Metadata = {
  title: 'Pricing · GildOps',
  description: 'The GildOps plans, and what changes the cost of implementation.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing · GildOps',
    description: 'The GildOps plans, and what changes the cost of implementation.',
    url: '/pricing',
  },
};

export default function PricingPage() {
  return (
    <div className="flex flex-col gap-14 py-6 sm:gap-20 sm:py-10">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Pricing</p>
        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
          A quote for what you actually use.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted">
          A single tool, AI set up with you and a connected system are priced differently. We give
          you a number after a short conversation; this page lists what shapes it.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PRICING_PACKAGES.map((pkg) => (
          <div key={pkg.key} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold">{pkg.name}</h2>
            <p className="text-sm leading-relaxed text-muted">{pkg.summary}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">What changes the price</h2>
        <div className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2">
          {PRICING_FACTORS.map((factor) => (
            <div key={factor.title} className="border-t-2 border-foreground pt-3">
              <h3 className="font-semibold">{factor.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{factor.body}</p>
            </div>
          ))}
        </div>
      </section>

      <CtaBand
        heading="Get a number for your own business."
        body="Request a consultation and we'll walk through which plan fits and what implementation looks like for you."
      />
    </div>
  );
}
