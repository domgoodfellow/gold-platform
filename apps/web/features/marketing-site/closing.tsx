import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { consultationHref, pricingHref, type Offering } from '@/lib/marketing/content';
import { FragmentGroup } from '@/features/visual-composition/fragment-group';
import { CLOSING } from './compositions';
import { MarketingSection } from '@/components/marketing/marketing-page';

interface ClosingLink {
  href: string;
  label: string;
}

/**
 * The closing band's composition: one dominant dark region holding the call to action, entered by
 * a seam that splits off two quieter pieces at its edge. The homepage draws its published closing
 * section through this; every other marketing page reaches it through `CtaBand`.
 */
export function ClosingComposition({ id, heading, body, primary, secondary }: {
  id: string;
  heading: string;
  body: string;
  primary: ClosingLink;
  secondary?: ClosingLink;
}) {
  return (
    <MarketingSection kind="cta">
      <section aria-labelledby={`${id}-heading`}>
        <FragmentGroup
          id={id}
          composition={CLOSING}
          materials={{ main: 'charcoal', upper: 'graphite', lower: 'cobalt' }}
          cells={[{
            fragment: 'main',
            className: 'ms-closing',
            content: (
              <>
                <h2 id={`${id}-heading`}>{heading}</h2>
                <p>{body}</p>
                <ButtonLink href={primary.href} className="ms-closing-action">
                  {primary.label} <ArrowRight aria-hidden size={16} />
                </ButtonLink>
                {secondary ? (
                  <p className="ms-closing-secondary">
                    <Link href={secondary.href}>{secondary.label}</Link>
                  </p>
                ) : null}
              </>
            ),
          }]}
        />
      </section>
    </MarketingSection>
  );
}

/**
 * The repeated final conversion band, the same visual weight everywhere it appears. Its main
 * action starts: the plans, narrowed to a product's on that product's page. Talking to GildOps is
 * the quieter link, with the product already chosen. A product not yet available is only asked
 * about.
 */
export function CtaBand({
  heading,
  body,
  product,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  heading: string;
  body: string;
  product?: Pick<Offering, 'id' | 'inSentence' | 'availability'>;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  const ask = { href: consultationHref(product), label: product ? `Ask about ${product.inSentence}` : 'Talk to us' };
  const primary = primaryHref && primaryLabel
    ? { href: primaryHref, label: primaryLabel }
    : product?.availability === 'not_yet' ? ask : { href: pricingHref(product), label: 'Get started' };
  const secondary = secondaryHref && secondaryLabel
    ? { href: secondaryHref, label: secondaryLabel }
    : primary.href === ask.href ? { href: '/how-it-works', label: 'See how it works' } : ask;
  return (
    <ClosingComposition
      id={`closing-${product?.id ?? 'page'}`}
      heading={heading}
      body={body}
      primary={primary}
      secondary={secondary}
    />
  );
}
