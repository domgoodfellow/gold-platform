import type { Metadata } from 'next';
import { ClipboardList, CalendarDays, Truck, Receipt } from 'lucide-react';
import { ProductLanding } from '@/components/marketing/product-landing';
import { ProductPreview } from '@/components/marketing/product-preview';
import { productBySlug } from '@/lib/marketing/content';

const product = productBySlug('operations')!;

export const metadata: Metadata = {
  title: `${product.name} · GOLD`,
  description: product.tagline,
  alternates: { canonical: '/operations' },
  openGraph: { title: `${product.name} · GOLD`, description: product.tagline, url: '/operations' },
};

export default function OperationsPage() {
  return (
    <ProductLanding
      product={product}
      preview={
        <ProductPreview
          areaLabel="Today"
          nav={[
            { icon: CalendarDays, label: 'Today', active: true },
            { icon: ClipboardList, label: 'Work' },
            { icon: Truck, label: 'Dispatch' },
            { icon: Receipt, label: 'Invoices' },
          ]}
          stats={[{ label: 'Committed today', value: '6' }, { label: 'Waiting to schedule', value: '2' }]}
          rows={[
            { lead: '09:00', title: 'Install · Reyes', detail: 'Van 2' },
            { lead: '11:30', title: 'Inspection · Okafor', detail: 'Van 1' },
            { lead: '14:00', title: 'Repair · Nguyen', detail: 'Bay 2' },
          ]}
        />
      }
    />
  );
}
