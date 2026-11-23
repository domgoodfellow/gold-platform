import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { consultationHref, pricingHref, type Offering } from '@/lib/marketing/content';

/**
 * A product's actions: start on a plan that includes it, or ask about it. A product not yet
 * available to new businesses is only asked about.
 */
export function StartActions({ offering }: { offering: Pick<Offering, 'id' | 'inSentence' | 'availability'> }) {
  if (offering.availability === 'not_yet') {
    return <ButtonLink href={consultationHref(offering)} tone="primary">Ask about {offering.inSentence}</ButtonLink>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <ButtonLink href={pricingHref(offering)} tone="primary">Get started</ButtonLink>
      <Link href={consultationHref(offering)} className="text-sm font-medium text-muted underline underline-offset-4 hover:text-foreground">
        Ask about {offering.inSentence}
      </Link>
    </div>
  );
}
