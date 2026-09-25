import type { Metadata } from 'next';
import { CtaBand } from '@/components/marketing/cta-band';
import { groupByCategory } from '@/lib/domain/integrations/published';
import { getPublishedConnectors } from '@/lib/domain/integrations/published-cache';

// Read at request time: the catalogue is data an admin edits, and is cached and expired by tag.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Integrations · GildOps',
  description: 'The tools GildOps connects to, and the ones on the way, organized by what they do for your business.',
  alternates: { canonical: '/integrations' },
  openGraph: {
    title: 'Integrations · GildOps',
    description: 'The tools GildOps connects to, and the ones on the way, organized by what they do for your business.',
    url: '/integrations',
  },
};

const STATUS_WORD = { planned: 'Planned', beta: 'Beta', live: null } as const;

export default async function IntegrationsPage() {
  const groups = groupByCategory(await getPublishedConnectors());

  return (
    <div className="flex flex-col gap-16 py-6 sm:gap-24 sm:py-10">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Integrations</p>
        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
          Connects to the tools you already run on.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted">
          GildOps is built to connect rather than replace everything on day one.
        </p>
      </div>

      <div className="grid gap-10 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.category}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-subtle">{group.category}</h2>
            <div className="mt-4 flex flex-col gap-4">
              {group.items.map((item) => (
                <div key={item.key} className="border-t-2 border-foreground pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {item.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.logoUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
                      ) : null}
                      <h3 className="font-semibold">{item.name}</h3>
                    </div>
                    {STATUS_WORD[item.status] ? (
                      <span className="shrink-0 font-mono text-xs uppercase tracking-wide text-subtle">{STATUS_WORD[item.status]}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{item.summary}</p>
                  {item.apps.length > 0 ? <p className="mt-1 text-xs text-subtle">{item.apps.join(' · ')}</p> : null}
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
