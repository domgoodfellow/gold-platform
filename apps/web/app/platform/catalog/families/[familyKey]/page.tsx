import { platformParams } from '@/lib/route/platform';
import { notFound } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { loadCatalogFamily } from '@/lib/application/platform/catalog-family';
import { CatalogFamilyScreen } from '@/features/platform/catalog/catalog-family-screen';

export const dynamic = 'force-dynamic';

export default async function ProductFamilyPage({ params }: PageProps<'/platform/catalog/families/[familyKey]'>) {
  const { organizationId: goldId, familyKey } = await platformParams(params);
  await requirePlatformArea(goldId, 'platform.catalogue');
  const model = await loadCatalogFamily(await getDb(), familyKey);
  if (!model) notFound();
  return <CatalogFamilyScreen goldId={goldId} model={model} />;
}
