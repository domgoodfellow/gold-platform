import type { Metadata } from 'next';
import { ProductLanding } from '@/components/marketing/product-landing';
import { productBySlug } from '@/lib/marketing/content';

const product = productBySlug('customer-service')!;

export const metadata: Metadata = {
  title: `${product.name} · GildOps`,
  description: product.tagline,
  alternates: { canonical: '/customer-service' },
  openGraph: { title: `${product.name} · GildOps`, description: product.tagline, url: '/customer-service' },
};

export default function CustomerServicePage() {
  return <ProductLanding product={product} />;
}
