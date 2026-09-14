import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RecordHeader } from '@/components/containers/record-header';
import { DefinitionList, Detail } from '@/components/display/data';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { DocumentsSection } from '@/features/documents/section';
import { ActivityList } from '@/features/timeline/activity-list';
import { geocodingProvider } from '@/lib/adapters/geocoding';
import { listAssets } from '@/lib/domain/assets/assets';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { getLocation } from '@/lib/domain/locations/locations';
import { listLocationTimeline } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { LocationCoordinatesForm } from '../location-forms';
import { locationCoordinatesAction, uploadLocationDocumentAction } from './actions';
import { LinkCustomerToLocationForm } from './link-customer-form';

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

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {/* No general "edit address" here, by design (docs/ui-domain-coverage.md): moving a
              location to a different address would silently relocate every job ever done there.
              The address and access notes shown here are exactly what was typed at creation. */}
          <DefinitionList>
            <Detail label="Address">{location.address}</Detail>
            <Detail label="Access notes">{location.accessNotes}</Detail>
          </DefinitionList>

          <CustomFieldValues definitions={definitions} custom={location.custom} />

          <Section className="mt-8">
            <SectionHeading>Coordinates</SectionHeading>
            <Hint className="mt-1">
              Derived from the address, for weather, travel time and service areas — a place with
              none is an ordinary place.
            </Hint>

            {mayEdit ? (
              <LocationCoordinatesForm
                organizationId={organizationId}
                location={location}
                mayLookUp={geocoding !== null}
                action={locationCoordinatesAction}
              />
            ) : (
              <Hint className="mt-2">
                Your role, {organization.role}, cannot change coordinates here.
              </Hint>
            )}
          </Section>

          <Section className="mt-8">
            <SectionHeading>Customers served</SectionHeading>

            {location.customers.length === 0 ? (
              <EmptyState className="mt-2">No customers served from here yet.</EmptyState>
            ) : (
              <DividedList className="mt-2">
                {location.customers.map((customer) => (
                  <li key={customer.id} className="py-2">
                    <Link
                      href={`/organizations/${organizationId}/customers/${customer.id}`}
                      className="underline underline-offset-4"
                    >
                      {customer.name}
                    </Link>
                  </li>
                ))}
              </DividedList>
            )}

            {mayEdit ? (
              <LinkCustomerToLocationForm
                organizationId={organizationId}
                locationId={locationId}
                customers={customers.map((customer) => ({ id: customer.id, name: customer.name }))}
              />
            ) : (
              <Hint className="mt-2">
                Your role, {organization.role}, cannot link customers here.
              </Hint>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="work" className="mt-6">
          {workItems.length === 0 ? (
            <EmptyState className="mt-2">No work recorded at this location.</EmptyState>
          ) : (
            <DividedList className="mt-2">
              {workItems.map((item) => (
                <li key={item.id} className="py-2">
                  <Link
                    href={`/organizations/${organizationId}/work/${item.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {item.title}
                  </Link>
                  <div className="text-sm text-muted">{item.status.label}</div>
                </li>
              ))}
            </DividedList>
          )}
        </TabsContent>

        <TabsContent value="assets" className="mt-6">
          {assets.length === 0 ? (
            <EmptyState className="mt-2">No assets recorded at this location.</EmptyState>
          ) : (
            <DividedList className="mt-2">
              {assets.map((asset) => (
                <li key={asset.id} className="py-2">
                  <Link
                    href={`/organizations/${organizationId}/assets/${asset.id}`}
                    className="underline underline-offset-4"
                  >
                    {asset.name}
                  </Link>
                </li>
              ))}
            </DividedList>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <DocumentsSection
            organizationId={organizationId}
            documents={documents}
            mayAttach={mayAttach}
            roleLabel={organization.role}
            uploadAction={uploadLocationDocumentAction}
            hiddenFields={{ organizationId, locationId }}
            className="mt-0"
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          {/* Not capability-gated, the same reasoning Customer and Work Item's own History
              sections give: `events` is already restricted by RLS to this tenant, so there is
              nothing here a member of this business may not see. */}
          <ActivityList timeline={timeline} timezone={organization.timezone} />
        </TabsContent>
      </Tabs>
    </>
  );
}
