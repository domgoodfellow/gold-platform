import type { Metadata } from 'next';
import { ProductLanding } from '@/components/marketing/product-landing';
import { productBySlug } from '@/lib/marketing/content';

const product = productBySlug('sales')!;

export const metadata: Metadata = {
  title: `${product.name} · GildOps`,
  description: product.tagline,
  alternates: { canonical: '/sales' },
  openGraph: { title: `${product.name} · GildOps`, description: product.tagline, url: '/sales' },
};

export default function SalesPage() {
  return <ProductLanding product={product} />;
}
