import { CustomFieldValues } from '@/components/custom-field-values';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { requireOrganization } from '@/lib/route/organization';
import { CreateLocationForm, LinkCustomerForm } from './location-forms';

export const dynamic = 'force-dynamic';

export default async function LocationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/locations'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [locations, customers, definitions] = await Promise.all([
    listLocations(db, { organizationId }),
    listCustomers(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'location' }),
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
