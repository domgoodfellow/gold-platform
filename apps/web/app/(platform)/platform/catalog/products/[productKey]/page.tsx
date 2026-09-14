import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/containers/record-header';
import { DefinitionList, Detail } from '@/components/display/data';
import { Section, SectionHeading } from '@/components/containers/section';
import { getDb } from '@/lib/db/server';
import { getProduct, listProductPrices, productKeyFromUrlSegment } from '@/lib/domain/commercial/catalogue';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { ProductForm } from '@/features/platform/catalog/product-form';

export default async function ProductPage({
  params,
}: PageProps<'/platform/catalog/products/[productKey]'>) {
  const { productKey } = await params;
  const db = await getDb();

  const product = await getProduct(db, productKeyFromUrlSegment(productKey));
  if (!product) {
    notFound();
  }

  const prices = await listProductPrices(db);
  const currentPrice = prices.find(
    (price) => price.productKey === product.key && price.approvalState === 'approved',
  );

  return (
    <>
      <RecordHeader
        title={product.label}
        crumbs={[
          { label: 'Products', href: '/platform/catalog/products' },
          { label: product.label },
        ]}
      />

      <DefinitionList>
        <Detail label="Key">{product.key}</Detail>
        <Detail label="Kind">{product.kind}</Detail>
        <Detail label="Linked module">
          {product.moduleKey ? (
            <Link href="/platform/catalog/modules" className="underline underline-offset-4">
              {product.moduleKey}
            </Link>
          ) : (
            '—'
          )}
        </Detail>
        <Detail label="Current list price">
          {currentPrice ? (
            <Link href="/platform/pricing" className="underline underline-offset-4">
              {formatMoney(currentPrice.amountMinor, currentPrice.currency)} /{' '}
              {currentPrice.billingInterval.replace('_', ' ')}
            </Link>
          ) : (
            <Link href="/platform/pricing" className="text-muted-foreground underline underline-offset-4">
              Not priced
            </Link>
          )}
        </Detail>
      </DefinitionList>

      <Section className="mt-10">
        <SectionHeading>Presentation and sale state</SectionHeading>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Key, kind and module mapping are code/deployment-owned and are not editable here.
        </p>
        <ProductForm product={product} />
      </Section>
    </>
  );
}
