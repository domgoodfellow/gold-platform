import { Disclosure } from '@/components/containers/card';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { geocodingProvider } from '@/lib/adapters/geocoding';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { requireOrganization } from '@/lib/route/organization';
import {
  CreateLocationForm,
  LinkCustomerForm,
  LocationCoordinatesForm,
} from './location-forms';

export const dynamic = 'force-dynamic';

export default async function LocationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/locations'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [locations, customers, definitions, geocoding] = await Promise.all([
    listLocations(db, { organizationId }),
    listCustomers(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'location' }),
    geocodingProvider(),
  ]);

  const mayAdd = organization.capabilities.includes('location.create');

  return (
    <>
      {/*
        Hiding the forms is a courtesy, not the guard. `locations_insert` and
        `customer_locations_insert` both require location.create in the database, so a caller
        who reaches either action anyway is refused there.
      */}
      {mayAdd ? (
        <div className="mt-6 flex flex-col gap-3">
          <Disclosure summary="Add a location" defaultOpen={locations.length === 0}>
            <CreateLocationForm organizationId={organizationId} definitions={definitions} />
          </Disclosure>
          {/* A second disclosure rather than a section of the first: linking an existing
              customer to an existing place is a different act from creating one, and folding
              them together would make each look like a step of the other. */}
          <Disclosure summary="Link a customer to a location">
            <LinkCustomerForm
              organizationId={organizationId}
              locations={locations}
              customers={customers}
            />
          </Disclosure>
        </div>
      ) : (
        <Hint className="mt-6">
          Your role, {organization.role}, cannot add locations here.
        </Hint>
      )}

      <div className="mt-6">
        <DataTable
          rows={locations}
          rowKey={(location) => location.id}
          empty="No locations yet."
          // **Coordinates are the row action, which is what they always were.** They are
          // derived from the address rather than part of it, so they belong beside the row
          // rather than inside its line — and a place with none is an ordinary place. Nothing
          // here nags and nothing is filled in on a business's behalf; what wants coordinates
          // is weather, travel time and service areas, none of which a business must use.
          actions={
            mayAdd
              ? (location) => (
                  <LocationCoordinatesForm
                    organizationId={organizationId}
                    location={location}
                    mayLookUp={geocoding !== null}
                  />
                )
              : undefined
          }
          columns={[
            {
              key: 'label',
              header: 'Place',
              emphasis: 'primary',
              cell: (location) => location.label,
            },
            {
              key: 'address',
              header: 'Address',
              cell: (location) => (
                <div className="flex flex-col">
                  <span>{location.address}</span>
                  {location.accessNotes ? (
                    <span className="text-muted">{location.accessNotes}</span>
                  ) : null}
                </div>
              ),
            },
            {
              key: 'customers',
              header: 'Serves',
              emphasis: 'secondary',
              cell: (location) =>
                location.customers.length > 0
                  ? location.customers.map((customer) => customer.name).join(', ')
                  : null,
            },
            ...(!mayAdd
              ? [
                  {
                    key: 'coordinates',
                    header: 'Coordinates',
                    emphasis: 'secondary' as const,
                    cell: (location: (typeof locations)[number]) =>
                      location.coordinates
                        ? `${location.coordinates.latitude}, ${location.coordinates.longitude}`
                        : null,
                  },
                ]
              : []),
            ...(definitions.length > 0
              ? [
                  {
                    key: 'custom',
                    header: 'Details',
                    emphasis: 'secondary' as const,
                    cell: (location: (typeof locations)[number]) => (
                      <CustomFieldValues definitions={definitions} custom={location.custom} />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>

    </>
  );
}
