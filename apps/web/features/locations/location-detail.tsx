import Link from 'next/link';
import { DefinitionList, Detail } from '@/components/display/data';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { DocumentsSection } from '@/features/documents/section';
import type { UploadDocumentState } from '@/features/documents/upload-form';
import { ActivityList } from '@/features/timeline/activity-list';
import type { TimelineEntry } from '@/lib/domain/timeline/timeline';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { Location } from '@/lib/domain/locations/locations';
import type { StoredDocument } from '@/lib/domain/documents/documents';
import { LinkCustomerLocationForm } from './link-customer-location-form';
import { LocationCoordinatesForm } from './location-coordinates-form';
import type { CoordinatesActionState, LocationActionState } from '@/app/organizations/[organizationId]/locations/actions';

/**
 * One location's record: what the route loaded, composed into Overview, Work, Assets, Documents
 * and Activity — the same five-tab shape other records use. The route still owns `RecordHeader`
 * and every Server Action; this owns only how the loaded data reads.
 */
export function LocationDetail({
  organizationId,
  location,
  definitions,
  customers,
  workItems,
  assets,
  documents,
  timeline,
  mayEdit,
  mayAttach,
  role,
  timezone,
  mayLookUp,
  coordinatesAction,
  linkCustomerAction,
  uploadAction,
}: {
  organizationId: string;
  location: Location;
  definitions: FieldDefinition[];
  customers: { id: string; name: string }[];
  workItems: { id: string; title: string; status: { label: string } }[];
  assets: { id: string; name: string }[];
  documents: StoredDocument[];
  timeline: TimelineEntry[];
  mayEdit: boolean;
  mayAttach: boolean;
  role: string;
  timezone: string;
  mayLookUp: boolean;
  coordinatesAction: (previous: CoordinatesActionState, formData: FormData) => Promise<CoordinatesActionState>;
  linkCustomerAction: (previous: LocationActionState, formData: FormData) => Promise<LocationActionState>;
  uploadAction: (previous: UploadDocumentState, formData: FormData) => Promise<UploadDocumentState>;
}) {
  return (
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

          {mayEdit ? (
            <LocationCoordinatesForm
              organizationId={organizationId}
              location={location}
              mayLookUp={mayLookUp}
              action={coordinatesAction}
            />
          ) : (
            <Hint className="mt-2">Your role, {role}, cannot change coordinates here.</Hint>
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
                    href={`/organizations/${organizationId}/crm/contacts/${customer.id}`}
                    className="underline underline-offset-4"
                  >
                    {customer.name}
                  </Link>
                </li>
              ))}
            </DividedList>
          )}

          {mayEdit ? (
            <LinkCustomerLocationForm
              organizationId={organizationId}
              customers={customers}
              locationId={location.id}
              action={linkCustomerAction}
            />
          ) : (
            <Hint className="mt-2">Your role, {role}, cannot link customers here.</Hint>
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
                <Link href={`/organizations/${organizationId}/assets/${asset.id}`} className="underline underline-offset-4">
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
          roleLabel={role}
          uploadAction={uploadAction}
          hiddenFields={{ organizationId, locationId: location.id }}
          className="mt-0"
        />
      </TabsContent>

      <TabsContent value="activity" className="mt-6">
        {/* Not capability-gated, the same reasoning Customer and Work Item's own History
            sections give: `events` is already restricted by RLS to this tenant, so there is
            nothing here a member of this business may not see. */}
        <ActivityList timeline={timeline} timezone={timezone} />
      </TabsContent>
    </Tabs>
  );
}
