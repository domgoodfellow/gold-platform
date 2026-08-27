import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CustomFieldValues } from '@/components/custom-field-values';
import { getDb } from '@/lib/db/server';
import { listCustomers } from '@/lib/domain/customers/customers';
import { DomainError } from '@/lib/domain/errors';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { CreateLocationForm, LinkCustomerForm } from './location-forms';

export const dynamic = 'force-dynamic';

export default async function LocationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/locations'>) {
  const { organizationId } = await params;
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/sign-in');
    }
    throw error;
  }

  const organization = await getOrganization(db, organizationId);
  if (!organization) {
    notFound();
  }

  const [locations, customers, definitions] = await Promise.all([
    listLocations(db, { organizationId }),
    listCustomers(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'location' }),
  ]);

  const mayAdd = organization.capabilities.includes('location.create');

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Locations</h1>
      <p className="text-sm opacity-70">{organization.name}</p>

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
    </main>
  );
}
