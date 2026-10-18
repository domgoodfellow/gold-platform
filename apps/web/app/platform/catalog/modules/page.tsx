import { platformParams } from '@/lib/route/platform';
import { requirePlatformArea } from '@/lib/route/platform';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listProducts } from '@/lib/domain/commercial/catalogue';
import { MODULES, moduleConfiguration, type Module } from '@/lib/navigation';

function surface(module: Module) {
  return module.outside ?? moduleConfiguration('organization', module).label;
}

export default async function ModulesPage({ params }: PageProps<'/platform/catalog/modules'>) {
  const { organizationId: goldId } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
  const products = await listProducts(await getDb());
  const byModule = new Map(products.filter((product) => product.moduleKey).map((product) => [product.moduleKey, product]));
  const modules: readonly Module[] = MODULES;

  return (
    <AppPage>
      <PageHeader
        title="Modules"
        crumbs={[...platformAncestry(goldId, 'products'), { label: 'Products', href: platformHref(goldId, 'catalog') }]}
      />
      <div>
        <DataTable
          rows={[...modules]}
          rowKey={(module) => module.key}
          empty="No optional modules are implemented."
          columns={[
            { key: 'module', header: 'Module', emphasis: 'primary', cell: (module) => <div><span className="font-medium">{module.label}</span><span className="block max-w-lg text-xs text-muted-foreground">{module.description}</span></div> },
            { key: 'key', header: 'Key', cell: (module) => module.key },
            { key: 'surface', header: 'Surface', cell: (module) => surface(module) },
            { key: 'requires', header: 'Depends on', cell: (module) => module.requires ?? '—' },
            { key: 'product', header: 'Commercial product', cell: (module) => { const product = byModule.get(module.key); return product ? <Link href={platformHref(goldId, 'catalog/products')} className="underline underline-offset-4">{product.key}</Link> : 'Not mapped'; } },
            { key: 'state', header: 'Sale state', cell: (module) => { const product = byModule.get(module.key); return product ? <Badge tone={product.saleStatus === 'active' ? 'success' : 'neutral'}>{product.saleStatus}</Badge> : <Badge>not sold</Badge>; } },
          ]}
        />
      </div>
    </AppPage>
  );
}
