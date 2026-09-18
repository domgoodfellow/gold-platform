import type { Metadata } from 'next';
import { CtaBand } from '@/components/marketing/cta-band';
import { HOW_IT_WORKS_STEPS } from '@/lib/marketing/content';

export const metadata: Metadata = {
  title: 'How it works · GOLD',
  description: 'How buying and setting up GOLD actually goes, from a first conversation to launch.',
  alternates: { canonical: '/how-it-works' },
  openGraph: {
    title: 'How it works · GOLD',
    description: 'How buying and setting up GOLD actually goes, from a first conversation to launch.',
    url: '/how-it-works',
  },
};

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col gap-16 py-6 sm:gap-24 sm:py-10">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">How it works</p>
        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
          You review every step before it goes live.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted">
          Nothing in GOLD is switched on for your business without you seeing it configured first.
        </p>
      </div>

      <ol className="divide-y divide-border border-y border-border">
        {HOW_IT_WORKS_STEPS.map((step, index) => (
          <li key={step.title} className="grid gap-2 py-6 sm:grid-cols-[3rem_16rem_1fr] sm:gap-6">
            <span className="font-mono text-sm text-subtle">{String(index + 1).padStart(2, '0')}</span>
            <h2 className="text-base font-semibold">{step.title}</h2>
            <p className="text-sm leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <CtaBand
        heading="Ready to see it against your own business?"
        body="Request a demo and tell us how you run today — we'll show you the parts of GOLD that fit."
        secondaryHref="/pricing"
        secondaryLabel="See pricing"
      />
    </div>
  );
}
