import type { Metadata } from 'next';
import { ProductLanding } from '@/components/marketing/product-landing';
import { productBySlug } from '@/lib/marketing/content';

const product = productBySlug('operations')!;

export const metadata: Metadata = {
  title: `${product.name} · GildOps`,
  description: product.tagline,
  alternates: { canonical: '/operations' },
  openGraph: { title: `${product.name} · GildOps`, description: product.tagline, url: '/operations' },
};

export default function OperationsPage() {
  return <ProductLanding product={product} />;
}
