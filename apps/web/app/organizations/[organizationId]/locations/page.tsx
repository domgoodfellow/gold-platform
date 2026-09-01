import { CustomFieldValues } from '@/components/custom-field-values';
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
      {locations.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No locations yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {locations.map((location) => (
            <li key={location.id} className="py-3">
              <div className="font-medium">{location.label}</div>
              <div className="text-sm opacity-70">{location.address}</div>

              {location.accessNotes ? (
                <div className="mt-1 text-sm opacity-70">{location.accessNotes}</div>
              ) : null}

              {location.customers.length > 0 ? (
                <div className="mt-1 text-sm opacity-70">
                  Serves {location.customers.map((customer) => customer.name).join(', ')}
                </div>
              ) : null}

              <CustomFieldValues definitions={definitions} custom={location.custom} />

              {/* Coordinates are derived from the address and are not part of it, so they sit
                  under the location rather than inside its line. A place with none is an
                  ordinary place — nothing here nags, and nothing is filled in on a business's
                  behalf. What needs them is weather, travel time and service areas, none of
                  which a business is obliged to use. */}
              {mayAdd ? (
                <LocationCoordinatesForm
                  organizationId={organizationId}
                  location={location}
                  mayLookUp={geocoding !== null}
                />
              ) : location.coordinates ? (
                <div className="mt-1 text-sm opacity-70">
                  {location.coordinates.latitude}, {location.coordinates.longitude}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/*
        Hiding the forms is a courtesy, not the guard. `locations_insert` and
        `customer_locations_insert` both require location.create in the database, so a caller
        who reaches either action anyway is refused there.
      */}
      {mayAdd ? (
        <>
          <CreateLocationForm organizationId={organizationId} definitions={definitions} />
          <LinkCustomerForm
            organizationId={organizationId}
            locations={locations}
            customers={customers}
          />
        </>
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot add locations here.
        </p>
      )}
    </>
  );
}
