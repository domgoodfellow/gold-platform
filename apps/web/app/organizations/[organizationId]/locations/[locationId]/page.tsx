import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/containers/record-header';
import { LocationDetail } from '@/features/locations/location-detail';
import { geocodingProvider } from '@/lib/adapters/geocoding';
import { listAssets } from '@/lib/domain/assets/assets';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { getLocation } from '@/lib/domain/locations/locations';
import { listLocationTimeline } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { linkCustomerAction, locationCoordinatesAction, uploadLocationDocumentAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function LocationPage({
  params,
}: PageProps<'/organizations/[organizationId]/locations/[locationId]'>) {
  const { organizationId, locationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's location id resolves to null, so this renders a 404 rather than an
  // empty page — the same indistinguishability `getCustomer` and `getAsset` rely on RLS for.
  const location = await getLocation(db, { organizationId, locationId });
  if (!location) {
    notFound();
  }

  const [customers, definitions, documents, assets, workItems, geocoding, timeline] = await Promise.all([
    listCustomers(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'location' }),
    listDocuments(db, { organizationId, attachedTo: { entity: 'location', id: locationId } }),
    listAssets(db, { organizationId, locationId }),
    listWorkItems(db, { organizationId, locationId }),
    geocodingProvider(),
    listLocationTimeline(db, { organizationId, locationId }),
  ]);

  const mayEdit = organization.capabilities.includes('location.create');
  const mayAttach = organization.capabilities.includes('document.create');

  return (
    <>
      <RecordHeader
        title={location.label}
        crumbs={[
          { label: 'Locations', href: `/organizations/${organizationId}/locations` },
          { label: location.label },
        ]}
      />

      <LocationDetail
        organizationId={organizationId}
        location={location}
        definitions={definitions}
        customers={customers.map((customer) => ({ id: customer.id, name: customer.name }))}
        workItems={workItems.map((item) => ({ id: item.id, title: item.title, status: { label: item.status.label } }))}
        assets={assets.map((asset) => ({ id: asset.id, name: asset.name }))}
        documents={documents}
        timeline={timeline}
        mayEdit={mayEdit}
        mayAttach={mayAttach}
        role={organization.role}
        timezone={organization.timezone}
        mayLookUp={geocoding !== null}
        coordinatesAction={locationCoordinatesAction}
        linkCustomerAction={linkCustomerAction}
        uploadAction={uploadLocationDocumentAction}
      />
    </>
  );
}
