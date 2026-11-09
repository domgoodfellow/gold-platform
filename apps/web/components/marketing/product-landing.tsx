import { CtaBand } from '@/components/marketing/cta-band';
import { FaqSection, faqStructuredData } from '@/components/marketing/faq-section';
import { ButtonLink } from '@/components/controls/button';
import { canonicalUrl } from '@/lib/seo/site';
import type { Product } from '@/lib/marketing/content';

/**
 * The shared skeleton for `/sales`, `/operations` and `/customer-service`: hero, problem, key
 * workflows, feature groups, how it connects, integrations, FAQ, CTA. No illustrated dashboard:
 * a made-up screen with sample customers is not a picture of what the visitor would get.
 */
export function ProductLanding({ product }: { product: Product }) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [{ ...faqStructuredData(product.faq), '@id': `${canonicalUrl(product.href).toString()}#faq` }],
  };

  return (
    <div className="flex flex-col gap-24 py-6 sm:gap-32 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />

      <section className="max-w-3xl">
        <div className="flex flex-col items-start gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">{product.name}</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
            {product.tagline}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">{product.problem}</p>
          <ButtonLink href="/demo" tone="primary">Request a demo</ButtonLink>
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

      <section className="grid gap-8 rounded-xl border border-border bg-surface p-6 sm:p-10 lg:grid-cols-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Connected, not standalone</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">How {product.name} connects to the rest of GildOps</h2>
        </div>
        <div className="grid gap-6 text-sm leading-relaxed text-muted sm:grid-cols-2 lg:col-span-2">
          {product.connectsTo.map((point) => <p key={point}>{point}</p>)}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Relevant integrations</h2>
        <p className="mt-3 max-w-xl text-muted">
          {product.integrations.join(' and ')} connect directly — see every integration on{' '}
          <a href="/integrations" className="underline underline-offset-4">/integrations</a>.
        </p>
      </section>

      <FaqSection items={product.faq} />

      <CtaBand
        heading={`See ${product.name} on your own operation.`}
        body={`Request a demo and we'll show you how ${product.name.toLowerCase()} would look in GildOps, using how your business actually works.`}
      />
    </div>
  );
}
