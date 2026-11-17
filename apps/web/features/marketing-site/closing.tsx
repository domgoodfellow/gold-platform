import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { consultationHref, type Offering } from '@/lib/marketing/content';
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
 * The repeated final conversion band, the same visual weight everywhere it appears. On a product's
 * page it names that product, so the consultation form opens with it already chosen.
 */
export function CtaBand({
  heading,
  body,
  product,
  secondaryHref = '/how-it-works',
  secondaryLabel = 'See how it works',
}: {
  heading: string;
  body: string;
  product?: Pick<Offering, 'id' | 'inSentence'>;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <ClosingComposition
      id={`closing-${product?.id ?? 'page'}`}
      heading={heading}
      body={body}
      primary={{ href: consultationHref(product), label: product ? `Ask about ${product.inSentence}` : 'Request a consultation' }}
      secondary={{ href: secondaryHref, label: secondaryLabel }}
    />
  );
}
