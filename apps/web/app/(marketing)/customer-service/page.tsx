import type { Metadata } from 'next';
import { Phone, MessageSquare, Mail, Globe } from 'lucide-react';
import { ProductLanding } from '@/components/marketing/product-landing';
import { ProductPreview } from '@/components/marketing/product-preview';
import { productBySlug } from '@/lib/marketing/content';

const product = productBySlug('customer-service')!;

export const metadata: Metadata = {
  title: `${product.name} · GOLD`,
  description: product.tagline,
  alternates: { canonical: '/customer-service' },
  openGraph: { title: `${product.name} · GOLD`, description: product.tagline, url: '/customer-service' },
};

export default function CustomerServicePage() {
  return (
    <ProductLanding
      product={product}
      preview={
        <ProductPreview
          areaLabel="Conversations"
          nav={[
            { icon: Phone, label: 'Phone', active: true },
            { icon: MessageSquare, label: 'SMS' },
            { icon: Mail, label: 'Email' },
            { icon: Globe, label: 'Website' },
          ]}
          stats={[{ label: 'Open conversations', value: '9' }, { label: 'Escalated', value: '1' }]}
          rows={[
            { lead: 'Call', title: 'Reyes · Booking question', detail: 'Resolved' },
            { lead: 'SMS', title: 'Okafor · Reschedule', detail: 'Awaiting reply' },
            { lead: 'Web', title: 'Nguyen · Pricing question', detail: 'Escalated' },
          ]}
        />
      }
    />
  );
}
