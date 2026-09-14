import Link from 'next/link';
import { Disclosure } from '@/components/containers/card';
import { AppPage } from '@/components/containers/app-page';
import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { geocodingProvider } from '@/lib/adapters/geocoding';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { requireOrganization } from '@/lib/route/organization';
import { CreateLocationSheetProvider, CreateLocationTrigger } from './create-location-sheet';
import { LinkCustomerForm, LocationCoordinatesForm } from './location-forms';

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
    <AppPage width="wide">
      <CreateLocationSheetProvider organizationId={organizationId} definitions={definitions}>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <PageHeading>Locations</PageHeading>
            <Hint className="mt-1">Places where this organization works, and the customers they serve.</Hint>
          </div>
          {/*
            Hiding the trigger is a courtesy, not the guard. `locations_insert` requires
            location.create in the database, so a caller who reaches the action anyway is
            refused there.
          */}
          {mayAdd ? <CreateLocationTrigger /> : null}
        </header>

        {/*
          Linking an existing customer to an existing place is a different act from creating
          one, so it keeps its own inline disclosure rather than folding into the Sheet.
          `customer_locations_insert` also requires location.create, so this is hidden on the
          same condition as the create trigger above.
        */}
        {mayAdd ? (
          <Disclosure summary="Link a customer to a location" className="mt-5">
            <LinkCustomerForm
              organizationId={organizationId}
              locations={locations}
              customers={customers}
            />
          </Disclosure>
        ) : null}

        <div className="mt-6">
          <DataTable
            rows={locations}
            rowKey={(location) => location.id}
            empty="No locations yet."
            emptyAction={mayAdd ? <CreateLocationTrigger /> : undefined}
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
                cell: (location) => (
                  <Link
                    href={`/organizations/${organizationId}/locations/${location.id}`}
                    className="underline underline-offset-4"
                  >
                    {location.label}
                  </Link>
                ),
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
      </CreateLocationSheetProvider>
    </AppPage>
  );
}
