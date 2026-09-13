import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeading } from '@/components/containers/section';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listProductPrices, listProducts, productKeyToUrlSegment } from '@/lib/domain/commercial/catalogue';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export default async function ProductsPage() {
  const db = await getDb();
  const [products, prices] = await Promise.all([listProducts(db), listProductPrices(db)]);

  const currentPrice = new Map<string, (typeof prices)[number]>();
  for (const price of prices) {
    if (price.approvalState === 'approved' && !currentPrice.has(price.productKey)) {
      currentPrice.set(price.productKey, price);
    }
  }

  return (
    <AppPage width="full">
      <PageHeading>Products</PageHeading>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        What GOLD sells. Presentation and sale state are staff-managed; identifiers and module
        mappings remain deployment-owned.
      </p>

      <div className="mt-6">
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
                    href={`/platform/catalog/products/${productKeyToUrlSegment(product.key)}`}
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
                  <Link className="underline underline-offset-4" href="/platform/catalog/modules">
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
                  <Link className="text-muted-foreground underline underline-offset-4" href="/platform/pricing">
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
