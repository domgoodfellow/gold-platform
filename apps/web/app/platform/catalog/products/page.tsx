import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listProducts, productKeyToUrlSegment } from '@/lib/domain/commercial/catalogue';

export default async function ProductsPage({ params }: PageProps<'/platform/catalog/products'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const products = await listProducts(db);

  return (
    <AppPage>
      <PageHeader title="Line items" crumbs={[...platformAncestry(goldId, 'products'), { label: 'Products', href: platformHref(goldId, 'catalog') }]} />

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
          ]}
        />
      </div>
    </AppPage>
  );
}
