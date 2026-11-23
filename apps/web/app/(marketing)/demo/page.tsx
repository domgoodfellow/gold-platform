import { MarketingPage, MarketingSection } from '@/components/marketing/marketing-page';
import { requestDemoAction } from './actions';
import { DemoForm } from './demo-form';
import type { Metadata } from 'next';
import { inquiryTopic } from '@/lib/marketing/inquiry';
import { formatPhoneForDisplay } from '@/lib/display/phone';
import { getPublishedGoldHomepage } from '@/lib/domain/public-site/cached';

const DESCRIPTION = 'Call GildOps, or leave your details and we’ll call you to work out what to set up and what it costs.';

export const metadata: Metadata = {
  title: 'Talk to us · GildOps',
  description: DESCRIPTION,
  alternates: { canonical: '/demo' },
  openGraph: {
    title: 'Talk to us · GildOps',
    description: DESCRIPTION,
    url: '/demo',
  },
};

/**
 * Talking to GildOps before buying, the funnel beside Pricing: every "Ask about" and "Talk to us"
 * link leads here. GildOps' own phone number, when its public profile has one, comes first; the
 * form asks GildOps to call back.
 * `?product=` names the product the visitor came from; an unknown value is ignored rather than
 * shown, so the form never offers a product this site does not describe.
 */
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ product?: string | string[] }> }) {
  const { product } = await searchParams;
  const topic = inquiryTopic(Array.isArray(product) ? product[0] : product);
  const { profile } = await getPublishedGoldHomepage();
  const phone = profile.contactPhone;

  return (
    <MarketingPage>
      <MarketingSection kind="content">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Talk to us
          </h1>
          <p className="max-w-lg text-muted">
            {phone ? 'Call us now, or leave your details and we’ll call you.' : 'Leave your details and we’ll call you.'}{' '}
            We&rsquo;ll work out with you what to set up and what it costs.{' '}
            Asking does not create an account or a business in GildOps.
          </p>
          {phone ? (
            <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="mt-2 w-fit text-2xl font-semibold tabular-nums underline underline-offset-4">
              {formatPhoneForDisplay(phone)}
            </a>
          ) : null}
        </div>
      </MarketingSection>

      <MarketingSection kind="content">
        <div className="max-w-md">
          <DemoForm action={requestDemoAction} initialProduct={topic?.value ?? null} />
        </div>
      </MarketingSection>
    </MarketingPage>
  );
}
