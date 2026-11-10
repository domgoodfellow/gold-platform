import { requestDemoAction } from './actions';
import { DemoForm } from './demo-form';
import type { Metadata } from 'next';
import { inquiryTopic } from '@/lib/marketing/inquiry';

const DESCRIPTION = 'Tell us what you’d like help with. We’ll say which GildOps products fit, what setting them up involves and what it costs.';

export const metadata: Metadata = {
  title: 'Request a consultation · GildOps',
  description: DESCRIPTION,
  alternates: { canonical: '/demo' },
  openGraph: {
    title: 'Request a consultation · GildOps',
    description: DESCRIPTION,
    url: '/demo',
  },
};

/**
 * The consultation request every "Ask about" and "Request a consultation" link leads to.
 * `?product=` names the product the visitor came from; an unknown value is ignored rather than
 * shown, so the form never offers a product this site does not describe.
 */
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ product?: string | string[] }> }) {
  const { product } = await searchParams;
  const topic = inquiryTopic(Array.isArray(product) ? product[0] : product);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Request a consultation
        </h1>
        <p className="max-w-lg text-muted">
          Tell us what you&rsquo;d like help with. We&rsquo;ll say which products fit, what setting
          them up involves and what it costs, and you review everything before it goes live.
          Filling this in does not create an account or a business in GildOps.
        </p>
      </div>

      <div className="max-w-md">
        <DemoForm action={requestDemoAction} initialProduct={topic?.value ?? null} />
      </div>
    </div>
  );
}
