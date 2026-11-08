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
          Tell us how your business runs today. We&rsquo;ll show you GildOps against it, set up a
          workspace around it, and you review exactly what&rsquo;s been set up before anything
          launches. Filling this in does not create an account or a business in GildOps.
        </p>
      </div>

      <div className="max-w-md">
        <DemoForm action={requestDemoAction} />
      </div>
    </div>
  );
}
