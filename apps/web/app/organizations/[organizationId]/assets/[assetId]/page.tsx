import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/containers/record-header';
import { AssetDetail } from '@/features/assets/asset-detail';
import { getAsset } from '@/lib/domain/assets/assets';
import { listAssetReadings } from '@/lib/domain/assets/readings';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listAssetTimeline } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { recordReadingAction, uploadAssetDocumentAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AssetPage({
  params,
}: PageProps<'/organizations/[organizationId]/assets/[assetId]'>) {
  const { organizationId, assetId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's asset id resolves to null, so this renders a 404 rather than an empty
  // page — the same indistinguishability `getCustomer` relies on RLS for.
  const asset = await getAsset(db, { organizationId, assetId });
  if (!asset) {
    notFound();
  }

  const [readings, definitions, documents, workItems, timeline] = await Promise.all([
    listAssetReadings(db, { organizationId, assetId }),
    listFieldDefinitions(db, { organizationId, entityType: 'asset' }),
    listDocuments(db, { organizationId, attachedTo: { entity: 'asset', id: assetId } }),
    listWorkItems(db, { organizationId, assetId }),
    listAssetTimeline(db, { organizationId, assetId }),
  ]);

  const mayRecord = organization.capabilities.includes('asset.create');
  const mayAttach = organization.capabilities.includes('document.create');

  return (
    <>
      <RecordHeader
        title={asset.name}
        crumbs={[
          { label: 'Assets', href: `/organizations/${organizationId}/assets` },
          { label: asset.name },
        ]}
      />

      <AssetDetail
        organizationId={organizationId}
        asset={asset}
        readings={readings}
        definitions={definitions}
        workItems={workItems.map((item) => ({ id: item.id, title: item.title, status: { label: item.status.label } }))}
        documents={documents}
        timeline={timeline}
        mayRecord={mayRecord}
        mayAttach={mayAttach}
        role={organization.role}
        timezone={organization.timezone}
        recordReadingAction={recordReadingAction}
        uploadAction={uploadAssetDocumentAction}
      />
    </>
  );
}
