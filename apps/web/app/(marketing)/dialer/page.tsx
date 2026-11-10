import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { AvailabilityLabel } from '@/components/marketing/availability-label';
import { CtaBand } from '@/components/marketing/cta-band';
import { FaqSection, faqStructuredData } from '@/components/marketing/faq-section';
import { FOCUS_RING, cx } from '@/components/class-names';
import { AVAILABILITY, DIALER, OFFERINGS, consultationHref, offeringById, offeringHref } from '@/lib/marketing/content';
import { canonicalUrl } from '@/lib/seo/site';

const DESCRIPTION = 'Make and take business calls in the browser, work through a call list, transfer calls and record how each one went. Use it on its own or with other GildOps products.';

export const metadata: Metadata = {
  title: 'Dialer · GildOps',
  description: DESCRIPTION,
  alternates: { canonical: '/dialer' },
  openGraph: { title: 'Dialer · GildOps', description: DESCRIPTION, url: '/dialer' },
};

/** The products the Dialer is most often used with, each linking to where it is described. */
const WORKS_WITH = ['sales', 'customer-service', 'ai-receptionist'].map((id) => OFFERINGS.find((offering) => offering.id === id)!);

const OFFERING = offeringById('dialer')!;

/**
 * The Dialer, offered on its own. Everything here is something the Dialer in the application does
 * (`features/communications/voice`), but the catalogue does not list it as available yet, so the
 * page says so up front and asks for a consultation. Nothing is shown as a picture of a screen,
 * because a made-up screen is not what the visitor would get. The page answers, in order: what it does,
 * who it is for and what it takes to start, how it differs from the AI receptionist, and what it
 * works with.
 */
export default function DialerPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [{ ...faqStructuredData(DIALER.faq), '@id': `${canonicalUrl('/dialer').toString()}#faq` }],
  };

  return (
    <div className="flex flex-col gap-14 py-6 sm:gap-20 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />

      <section className="flex max-w-3xl flex-col items-start gap-6">
        <p className="flex flex-wrap items-center gap-3 text-sm font-medium text-muted">
          Dialer
          <AvailabilityLabel availability={OFFERING.availability} />
        </p>
        <h1 className="text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">{DIALER.heading}</h1>
        <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted">{DIALER.body}</p>
        {OFFERING.availability === 'available' ? null : (
          <p className="max-w-xl text-pretty text-sm leading-relaxed text-muted">{AVAILABILITY[OFFERING.availability].note}</p>
        )}
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
          <ButtonLink href={consultationHref(OFFERING)} tone="primary">Ask about {OFFERING.inSentence}</ButtonLink>
          <a href="#compare" className={cx('rounded text-sm font-medium text-muted hover:text-foreground', FOCUS_RING)}>
            How it differs from the AI receptionist
          </a>
        </div>
      </section>

      <section aria-labelledby="dialer-what">
        <h2 id="dialer-what" className="text-2xl font-semibold tracking-tight sm:text-3xl">What it does, call by call</h2>
        <ol className="mt-10 grid gap-x-10 gap-y-12 md:grid-cols-3">
          {DIALER.phases.map((phase, index) => (
            <li key={phase.name} className="flex flex-col gap-6 border-t-2 border-foreground pt-4">
              <h3 className="flex items-baseline gap-3 text-lg font-semibold tracking-tight">
                <span aria-hidden className="font-mono text-sm text-subtle">{String(index + 1).padStart(2, '0')}</span>
                {phase.name}
              </h3>
              <ul className="flex flex-col gap-5">
                {phase.items.map((item) => (
                  <li key={item.title}>
                    <h4 className="text-sm font-semibold">{item.title}</h4>
                    <p className="mt-1.5 text-pretty text-sm leading-relaxed text-muted">{item.body}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="mt-10 max-w-2xl text-pretty text-sm leading-relaxed text-muted">{DIALER.unanswered}</p>
      </section>

      <section aria-labelledby="dialer-start" className="-mx-2 rounded-2xl bg-secondary px-6 py-12 sm:px-12 sm:py-16">
        <h2 id="dialer-start" className="max-w-xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Who it is for, and what it takes to start</h2>
        <dl className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {DIALER.facts.map((fact) => (
            <div key={fact.title}>
              <dt className="font-semibold">{fact.title}</dt>
              <dd className="mt-2 text-pretty text-sm leading-relaxed text-muted">{fact.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="compare" aria-labelledby="dialer-compare" className="scroll-mt-24">
        <h2 id="dialer-compare" className="max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{DIALER.comparison.heading}</h2>
        <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
          <div className="border-t-2 border-foreground pt-4">
            <h3 className="font-semibold">Dialer</h3>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">{DIALER.comparison.dialer}</p>
          </div>
          <div className="border-t-2 border-foreground pt-4">
            <h3 className="font-semibold">AI receptionist</h3>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">{DIALER.comparison.receptionist}</p>
          </div>
        </div>
        <p className="mt-8 max-w-2xl text-pretty leading-relaxed">{DIALER.comparison.together}</p>
      </section>

      <section aria-labelledby="dialer-with" className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div className="flex max-w-md flex-col gap-3">
          <h2 id="dialer-with" className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">On its own, or with the rest</h2>
          <p className="text-pretty text-muted">
            The Dialer comes with contacts, the call list and call history. Add other products when they help;
            the calls already made stay on the same customer records.
          </p>
        </div>
        <ul className="border-t border-border">
          {WORKS_WITH.map((offering) => (
            <li key={offering.id} className="border-b border-border">
              <Link
                href={offeringHref(offering)}
                className={cx('group -mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 rounded-md px-3 py-5 transition-colors hover:bg-secondary', FOCUS_RING)}
              >
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-lg font-semibold tracking-tight">{offering.name}</span>
                  <AvailabilityLabel availability={offering.availability} />
                </span>
                <span className="col-start-1 text-pretty text-sm leading-relaxed text-muted">{offering.summary}</span>
                <ArrowRight aria-hidden size={18} className="col-start-2 row-span-2 row-start-1 text-muted transition-transform group-hover:text-foreground motion-safe:group-hover:translate-x-1" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <FaqSection items={DIALER.faq} />

      <CtaBand
        heading="Put your team's calls in one place."
        body="Tell us how many people make calls and whether you need new numbers. We'll tell you what setting the Dialer up involves, what it costs and when it can be set up for you."
        product={OFFERING}
        secondaryHref="/products"
        secondaryLabel="See every product"
      />
    </div>
  );
}
