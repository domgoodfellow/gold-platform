import type { Metadata } from 'next';
import { CtaBand } from '@/components/marketing/cta-band';
import { INTEGRATIONS } from '@/lib/marketing/content';

export const metadata: Metadata = {
  title: 'Integrations · GOLD',
  description: 'The tools GOLD connects to today, organized by what they do for your business.',
  alternates: { canonical: '/integrations' },
  openGraph: {
    title: 'Integrations · GOLD',
    description: 'The tools GOLD connects to today, organized by what they do for your business.',
    url: '/integrations',
  },
};

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col gap-16 py-6 sm:gap-24 sm:py-10">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Integrations</p>
        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
          Connects to the tools you already run on.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted">
          GOLD is built to connect rather than replace everything on day one.
        </p>
      </div>

      <div className="grid gap-10 sm:grid-cols-2">
        {INTEGRATIONS.map((category) => (
          <div key={category.category}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">{category.category}</h2>
            <div className="mt-4 flex flex-col gap-4">
              {category.items.map((item) => (
                <div key={item.name} className="border-t-2 border-foreground pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{item.name}</h3>
                    {item.status === 'planned' ? (
                      <span className="shrink-0 font-mono text-xs uppercase tracking-wide text-subtle">Planned</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <CtaBand
        heading="Don't see what you use?"
        body="Request a demo and tell us what you're running today — we'll tell you plainly whether it connects."
      />
    </div>
  );
}
