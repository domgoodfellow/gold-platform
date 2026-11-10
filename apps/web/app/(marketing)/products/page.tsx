import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AvailabilityLabel } from '@/components/marketing/availability-label';
import { CtaBand } from '@/components/marketing/cta-band';
import { FOCUS_RING, cx } from '@/components/class-names';
import { AVAILABILITY, OFFERING_GROUPS, consultationHref, offeringsIn } from '@/lib/marketing/content';

const DESCRIPTION = 'Every GildOps product: tools you can use on their own, AI and automation set up with you, and connected applications. What each does and what you need to start.';

export const metadata: Metadata = {
  title: 'Products · GildOps',
  description: DESCRIPTION,
  alternates: { canonical: '/products' },
  openGraph: { title: 'Products · GildOps', description: DESCRIPTION, url: '/products' },
};

/**
 * Every product GildOps offers, grouped by how a business gets it. A product without a page of
 * its own is described here in full, under an anchor the homepage and the Products menu link to,
 * rather than on a thin page of its own.
 *
 * Rows, not boxed cards: each product is read for what it needs and what it works with, which is
 * a comparison down a page, not a grid to scan across.
 */
export default function ProductsPage() {
  return (
    <div className="flex flex-col gap-20 py-6 sm:gap-28 sm:py-10">
      <header className="flex max-w-3xl flex-col gap-6">
        <h1 className="text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
          Use one tool, or several together.
        </h1>
        <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted">
          Every product below works on its own. Each says whether you can have it today, what you
          need to start, and what it works with if you add more later. Each is set up with you after
          a consultation.
        </p>
        <nav aria-label="Product groups" className="flex flex-wrap gap-2 text-sm">
          {OFFERING_GROUPS.map((group) => (
            <a
              key={group.key}
              href={`#${group.key}`}
              className={cx('rounded-full border border-border px-3 py-1.5 text-muted transition-colors hover:border-foreground/40 hover:text-foreground', FOCUS_RING)}
            >
              {group.name}
            </a>
          ))}
        </nav>
      </header>

      {OFFERING_GROUPS.map((group) => (
        <section key={group.key} id={group.key} aria-labelledby={`${group.key}-heading`} className="scroll-mt-24">
          <div className="flex max-w-2xl flex-col gap-3">
            <h2 id={`${group.key}-heading`} className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{group.name}</h2>
            <p className="text-pretty text-muted">{group.summary}</p>
          </div>

          <div className="mt-10 border-b border-border">
            {offeringsIn(group.key).map((offering) => (
              <article
                key={offering.id}
                id={offering.id}
                aria-labelledby={`${offering.id}-name`}
                className="grid scroll-mt-24 gap-6 border-t border-border py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-16"
              >
                <div className="flex flex-col items-start gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 id={`${offering.id}-name`} className="text-xl font-semibold tracking-tight">{offering.name}</h3>
                    <AvailabilityLabel availability={offering.availability} />
                  </div>
                  <p className="text-pretty leading-relaxed text-muted">{offering.summary}</p>
                  {offering.availability === 'not_yet' ? (
                    <p className="text-pretty text-sm leading-relaxed text-muted">{AVAILABILITY.not_yet.note}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium">
                    {offering.page ? (
                      <Link href={offering.page} className={cx('group inline-flex items-center gap-1.5 rounded', FOCUS_RING)}>
                        More about {offering.inSentence}
                        <ArrowRight aria-hidden size={14} className="transition-transform motion-safe:group-hover:translate-x-0.5" />
                      </Link>
                    ) : null}
                    <Link href={consultationHref(offering)} className={cx('rounded text-muted underline underline-offset-4 hover:text-foreground', FOCUS_RING)}>
                      Ask about {offering.inSentence}
                    </Link>
                  </div>
                </div>
                <dl className="grid gap-6 text-sm sm:grid-cols-2 sm:gap-8">
                  <div className="border-t-2 border-foreground pt-3">
                    <dt className="font-semibold">What you need</dt>
                    <dd className="mt-2 leading-relaxed text-muted">{offering.needs}</dd>
                  </div>
                  <div className="border-t-2 border-foreground pt-3">
                    <dt className="font-semibold">Works with</dt>
                    <dd className="mt-2 leading-relaxed text-muted">{offering.worksWith}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}

      <CtaBand
        heading="Not sure which fits?"
        body="Tell us the task you want help with. We'll say which product fits, what setting it up involves and what it costs."
        secondaryHref="/how-it-works"
        secondaryLabel="See how a project runs"
      />
    </div>
  );
}
