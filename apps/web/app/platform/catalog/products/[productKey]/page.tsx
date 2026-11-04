import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/headers/record-header';
import { DefinitionList, Detail } from '@/components/display/data';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { getDb } from '@/lib/db/server';
import { getProduct, listProductPrices, productKeyFromUrlSegment } from '@/lib/domain/commercial/catalogue';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { ProductForm } from '@/features/platform/catalog/product-form';

export default async function ProductPage({
  params,
}: PageProps<'/platform/catalog/products/[productKey]'>) {
  const { organizationId: goldId, productKey } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
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
          ...platformAncestry(goldId, 'products'),
          { label: 'Products', href: platformHref(goldId, 'catalog') },
          { label: 'Line items', href: platformHref(goldId, 'catalog/products') },
          { label: product.label },
        ]}
      />

      <DefinitionList>
        <Detail label="Key">{product.key}</Detail>
        <Detail label="Kind">{product.kind}</Detail>
        <Detail label="Linked module">
          {product.moduleKey ? (
            <Link href={platformHref(goldId, 'catalog/modules')} className="underline underline-offset-4">
              {product.moduleKey}
            </Link>
          ) : (
            '—'
          )}
        </Detail>
        <Detail label="Current list price">
          {currentPrice ? (
            <Link href={platformHref(goldId, 'pricing')} className="underline underline-offset-4">
              {formatMoney(currentPrice.amountMinor, currentPrice.currency)} /{' '}
              {currentPrice.billingInterval.replace('_', ' ')}
            </Link>
          ) : (
            <Link href={platformHref(goldId, 'pricing')} className="text-muted-foreground underline underline-offset-4">
              Not priced
            </Link>
          )}
        </Detail>
      </DefinitionList>

      <Section className="mt-10">
        <SectionHeading>Presentation and sale state</SectionHeading>
        <ProductForm product={product} />
      </Section>
    </>
  );
}
