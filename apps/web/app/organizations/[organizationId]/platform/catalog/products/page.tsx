import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listProductPrices, listProducts, productKeyToUrlSegment } from '@/lib/domain/commercial/catalogue';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export default async function ProductsPage({ params }: PageProps<'/organizations/[organizationId]/platform/catalog/products'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const [products, prices] = await Promise.all([listProducts(db), listProductPrices(db)]);

  const currentPrice = new Map<string, (typeof prices)[number]>();
  for (const price of prices) {
    if (price.approvalState === 'approved' && !currentPrice.has(price.productKey)) {
      currentPrice.set(price.productKey, price);
    }
  }

  return (
    <AppPage>
      <PageHeader title="Line items" crumbs={[...platformAncestry(goldId, 'products'), { label: 'Products', href: platformHref(goldId, 'catalog') }]} description="The legacy flat SKUs this platform still sells by, one level under the seven Products. Presentation and sale state are staff-managed; identifiers and module mappings remain deployment-owned." />

      <div>
        <DataTable
          rows={products}
          rowKey={(product) => product.key}
          empty="No platform products recorded."
          columns={[
            {
              key: 'label',
              header: 'Product',
              emphasis: 'primary',
              cell: (product) => (
                <div>
                  <Link
                    href={platformHref(goldId, `catalog/products/${productKeyToUrlSegment(product.key)}`)}
                    className="font-medium underline underline-offset-4"
                  >
                    {product.label}
                  </Link>
                  <span className="block max-w-md text-xs text-muted-foreground">
                    {product.description || product.key}
                  </span>
                </div>
              ),
            },
            { key: 'kind', header: 'Kind', cell: (product) => product.kind },
            {
              key: 'module',
              header: 'Linked module',
              cell: (product) =>
                product.moduleKey ? (
                  <Link className="underline underline-offset-4" href={platformHref(goldId, 'catalog/modules')}>
                    {product.moduleKey}
                  </Link>
                ) : (
                  '—'
                ),
            },
            {
              key: 'state',
              header: 'Sale state',
              cell: (product) => (
                <Badge tone={product.saleStatus === 'active' ? 'success' : 'neutral'}>
                  {product.saleStatus}
                </Badge>
              ),
            },
            {
              key: 'price',
              header: 'Current list price',
              cell: (product) => {
                const price = currentPrice.get(product.key);
                return price ? (
                  `${formatMoney(price.amountMinor, price.currency)} / ${price.billingInterval.replace('_', ' ')}`
                ) : (
                  <Link className="text-muted-foreground underline underline-offset-4" href={platformHref(goldId, 'pricing')}>
                    Not priced
                  </Link>
                );
              },
            },
          ]}
        />
      </div>
    </AppPage>
  );
}
