import { requestDemoAction } from './actions';
import { DemoForm } from './demo-form';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Request a demo · GildOps',
  description: 'Tell us about your business and we’ll show you the parts of GildOps that fit it.',
  alternates: { canonical: '/demo' },
  openGraph: {
    title: 'Request a demo · GildOps',
    description: 'Tell us about your business and we’ll show you the parts of GildOps that fit it.',
    url: '/demo',
  },
};

export default function DemoPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Request a demo
        </h1>
        <p className="max-w-lg text-muted">
          Tell us what you&rsquo;d like help with, whether that is one tool or several. We&rsquo;ll
          show you the products that fit, say what setting them up involves and what it costs, and
          you review everything before it goes live. Filling this in does not create an account or a
          business in GildOps.
        </p>
      </div>

      <div className="max-w-md">
        <DemoForm action={requestDemoAction} />
      </div>
    </div>
  );
}
