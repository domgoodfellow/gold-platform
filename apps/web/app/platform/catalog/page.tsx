import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { Progress } from '@gold/ui/components/progress';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import { listPlanProductGrants, listPlans } from '@/lib/domain/catalogue/plans';

export const dynamic = 'force-dynamic';

/**
 * The canonical Product landing page — the eight Gild Products and the shared Workspace, browsed as cards rather than a dense
 * table. `platform_products` (GOLD's flat sellable-line-item catalogue) stays reachable from
 * "Catalog" -> "Line items" in the platform nav, one click deeper, as advanced/debug information.
 */
export default async function CatalogPage({ params }: PageProps<'/platform/catalog'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const [products, modules, features, plans] = await Promise.all([
    listCatalogProducts(db),
    listCatalogModules(db),
    listCatalogFeatures(db),
    listPlans(db),
  ]);

  const modulesByProduct = new Map<string, number>();
  for (const catalogModule of modules) {
    modulesByProduct.set(catalogModule.productId, (modulesByProduct.get(catalogModule.productId) ?? 0) + 1);
  }

  const moduleProductId = new Map(modules.map((m) => [m.id, m.productId]));
  const featuresByProduct = new Map<string, { total: number; available: number }>();
  for (const feature of features) {
    const productId = moduleProductId.get(feature.moduleId);
    if (!productId) continue;
    const entry = featuresByProduct.get(productId) ?? { total: 0, available: 0 };
    entry.total += 1;
    if (feature.implementationState === 'available') entry.available += 1;
    featuresByProduct.set(productId, entry);
  }

  // A plan grants a Product either directly, or through one of its Modules.
  const grantsByPlan = await Promise.all(plans.map(async (plan) => ({ plan, products: await listPlanProductGrants(db, plan.id) })));
  const plansByProductKey = new Map<string, number>();
  for (const { products: keys } of grantsByPlan) {
    for (const key of keys) plansByProductKey.set(key, (plansByProductKey.get(key) ?? 0) + 1);
  }

  const renderProduct = (product: (typeof products)[number]) => {
        const moduleCount = modulesByProduct.get(product.id) ?? 0;
        const featureCounts = featuresByProduct.get(product.id) ?? { total: 0, available: 0 };
        const coverage = featureCounts.total > 0 ? Math.round((featureCounts.available / featureCounts.total) * 100) : null;
        const planCount = plansByProductKey.get(product.key) ?? 0;

        return (
          <Card key={product.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{product.label}</CardTitle>
                {product.lifecycle !== 'stable' ? <Badge>{product.lifecycle}</Badge> : null}
              </div>
              {/* ui-copy-allow: the product's own description field, record data the catalog lists */}
              <CardDescription>{product.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Modules</dt>
                  <dd className="font-medium">{moduleCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Features</dt>
                  <dd className="font-medium">{featureCounts.total}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Plans</dt>
                  <dd className="font-medium">{planCount}</dd>
                </div>
              </dl>

              {coverage !== null ? (
                <div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Implementation</span>
                    <span>{coverage}%</span>
                  </div>
                  <Progress value={coverage} className="mt-1" />
                </div>
              ) : null}

              <Link
                href={platformHref(goldId, `catalog/families/${product.key}`)}
                className="mt-1 text-sm font-medium underline underline-offset-4"
              >
                Open
              </Link>
            </CardContent>
          </Card>
        );
  };

  return (
    <AppPage>
      <PageHeader title="Products" crumbs={platformAncestry(goldId, 'products')} />

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={platformHref(goldId, 'plans')} className="underline underline-offset-4">
          Plans &amp; Add-ons (Finance)
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={platformHref(goldId, 'catalog/products')} className="underline underline-offset-4">
          Line items (legacy SKUs)
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={platformHref(goldId, 'catalog/modules')} className="underline underline-offset-4">
          Runtime modules
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={platformHref(goldId, 'catalog/meters')} className="underline underline-offset-4">
          Meters
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.filter((product) => product.kind === 'product').map(renderProduct)}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Shared workspace</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.filter((product) => product.kind === 'workspace').map(renderProduct)}
      </div>
    </AppPage>
  );
}
