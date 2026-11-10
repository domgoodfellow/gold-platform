import { CtaBand } from '@/components/marketing/cta-band';
import { FaqSection, faqStructuredData } from '@/components/marketing/faq-section';
import { ButtonLink } from '@/components/controls/button';
import { AvailabilityLabel } from '@/components/marketing/availability-label';
import { canonicalUrl } from '@/lib/seo/site';
import { AVAILABILITY, consultationHref, offeringById, type Product } from '@/lib/marketing/content';

/**
 * The shared skeleton for the connected applications, `/sales`, `/operations` and
 * `/customer-service`: hero, problem, key workflows, feature groups, how it works with other
 * products, integrations, FAQ, CTA. No illustrated dashboard: a made-up screen with sample
 * customers is not a picture of what the visitor would get. The FAQ is drawn, and claimed in
 * structured data, only when the product has questions to answer.
 */
export function ProductLanding({ product }: { product: Product }) {
  const offering = offeringById(product.slug)!;
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [{ ...faqStructuredData(product.faq), '@id': `${canonicalUrl(product.href).toString()}#faq` }],
  };

  return (
    <div className="flex flex-col gap-14 py-6 sm:gap-20 sm:py-10">
      {product.faq.length ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
        />
      ) : null}

      <section className="max-w-3xl">
        <div className="flex flex-col items-start gap-6">
          <p className="flex flex-wrap items-center gap-3 text-sm font-medium text-muted">
            {product.name}
            <AvailabilityLabel availability={offering.availability} />
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
            {product.tagline}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">{product.problem}</p>
          {offering.availability === 'available' ? null : (
            <p className="max-w-xl text-pretty text-sm leading-relaxed text-muted">{AVAILABILITY[offering.availability].note}</p>
          )}
          <ButtonLink href={consultationHref(offering)} tone="primary">Ask about {offering.inSentence}</ButtonLink>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Key workflows</h2>
        <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {product.workflows.map((workflow) => (
            <article key={workflow.title} className="border-t-2 border-foreground pt-4">
              <h3 className="font-semibold">{workflow.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{workflow.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        {product.featureGroups.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-muted">
              {group.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden>—</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="grid gap-8 border-t border-border pt-8 lg:grid-cols-3 lg:gap-16">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">How {product.name} works with other GildOps products</h2>
        </div>
        <div className="grid gap-6 text-sm leading-relaxed text-muted sm:grid-cols-2 lg:col-span-2">
          {product.connectsTo.map((point) => <p key={point}>{point}</p>)}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Relevant integrations</h2>
        <p className="mt-3 max-w-xl text-muted">
          Works with {product.integrations.join(' and ')}. See every integration on{' '}
          <a href="/integrations" className="underline underline-offset-4">/integrations</a>.
        </p>
      </section>

      {product.faq.length ? <FaqSection items={product.faq} /> : null}

      <CtaBand
        heading={`Talk to us about ${product.name}.`}
        body={`Tell us how your business works today. We'll say what setting up ${product.name} involves, what it costs and when it can be ready.`}
        product={offering}
      />
    </div>
  );
}
