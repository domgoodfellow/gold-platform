import type { Metadata } from 'next';
import { Users, Phone, MessageSquare, CalendarClock } from 'lucide-react';
import { ProductLanding } from '@/components/marketing/product-landing';
import { ProductPreview } from '@/components/marketing/product-preview';
import { productBySlug } from '@/lib/marketing/content';

const product = productBySlug('sales')!;

export const metadata: Metadata = {
  title: `${product.name} · GildOps`,
  description: product.tagline,
  alternates: { canonical: '/sales' },
  openGraph: { title: `${product.name} · GildOps`, description: product.tagline, url: '/sales' },
};

export default function SalesPage() {
  return (
    <ProductLanding
      product={product}
      preview={
        <ProductPreview
          areaLabel="Pipeline"
          nav={[
            { icon: Users, label: 'Pipeline', active: true },
            { icon: Phone, label: 'Calls' },
            { icon: MessageSquare, label: 'Messages' },
            { icon: CalendarClock, label: 'Follow-ups' },
          ]}
          stats={[{ label: 'Open leads', value: '18' }, { label: 'Booked this week', value: '5' }]}
          rows={[
            { lead: 'New', title: 'Reyes · Roof inspection', detail: 'Inbound call' },
            { lead: 'Qtd', title: 'Okafor · Fence repair', detail: 'Quote sent' },
            { lead: 'Won', title: 'Nguyen · Full install', detail: 'Booked' },
          ]}
        />
      }
    />
  );
}
