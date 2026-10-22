import Link from 'next/link';
import { Disclosure } from '@/components/surfaces/card';
import { Hint } from '@/components/controls/inputs';
import { AppPage } from '@/components/layout/app-page';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { LocationConfiguration } from '@/features/locations/configuration/location-configuration';
import { CreateLocationSheetProvider, CreateLocationTrigger } from '@/features/locations/create-location-sheet';
import { LinkCustomerLocationForm } from '@/features/locations/link-customer-location-form';
import { LocationTable } from '@/features/locations/location-table';
import { LocationMapLoader } from '@/features/locations/map/location-map-loader';
import { LocationsViewNav } from '@/features/locations/locations-view-nav';
import { resolveLocationsView } from '@/features/locations/locations-view';
import { geocodingProvider } from '@/lib/adapters/geocoding';
import { mapConfig } from '@/lib/adapters/maps/config';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function LocationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/locations'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const view = resolveLocationsView(query.view);
  const { db, organization } = await requireOrganization(organizationId);

  const [locations, customers, definitions, geocoding] = await Promise.all([
    listLocations(db, { organizationId }),
    listContacts(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'location' }),
    geocodingProvider(),
  ]);

  const mayAdd = organization.capabilities.includes('location.create');
  const mayConfigure = organization.capabilities.includes('field.manage');
  const styleUrl = mapConfig()?.styleUrl ?? null;

  // A customer's own sites, read through the link CRM already reads (`CustomerLocationsSection`'s
  // "View all") — filtered in memory rather than a second query, since this route already loads
  // every location and its linked customers for the List/Map toggle regardless.
  const filterCustomerId = typeof query.customer === 'string' ? query.customer : undefined;
  const filterCustomer = filterCustomerId
    ? customers.find((customer) => customer.id === filterCustomerId)
    : undefined;
  const visibleLocations = filterCustomerId
    ? locations.filter((location) => location.customers.some((customer) => customer.id === filterCustomerId))
    : locations;
  const clearFilterHref = `/organizations/${organizationId}/locations${view === 'map' ? '?view=map' : ''}`;

  return (
    <AppPage>
      <CreateLocationSheetProvider organizationId={organizationId} definitions={definitions}>
        {/*
          Hiding the trigger is a courtesy, not the guard. `locations_insert` requires
          location.create in the database, so a caller who reaches the action anyway is
          refused there.
        */}
        <CollectionHeader
          title={areaLabel('locations')}
          crumbs={workspaceAncestry(organizationId, 'locations')}
          actions={mayAdd ? <CreateLocationTrigger /> : null}
          configure={mayConfigure}
        />
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Locations configuration"
            settingsHref={`/organizations/${organizationId}/settings/custom-fields`}
          >
            <LocationConfiguration
              organizationId={organizationId}
              role={organization.role}
              mayConfigure={mayConfigure}
              definitions={definitions}
            />
          </ConfigureRegistrar>
        ) : null}

        <LocationsViewNav organizationId={organizationId} view={view} />

        {filterCustomerId ? (
          <Hint className="mt-3 flex items-center justify-between gap-3">
            <span>
              Showing locations for {filterCustomer?.name ?? 'this customer'} ({visibleLocations.length})
            </span>
            <Link href={clearFilterHref} className="shrink-0 underline underline-offset-4">
              Show all locations
            </Link>
          </Hint>
        ) : null}

        {view === 'list' ? (
          <>
            {/*
              Linking an existing customer to an existing place is a different act from
              creating one, so it keeps its own inline disclosure rather than folding into the
              Sheet. `customer_locations_insert` also requires location.create, so this is
              hidden on the same condition as the create trigger above.
            */}
            {mayAdd ? (
              <Disclosure summary="Link a customer to a location" className="mt-3">
                <LinkCustomerLocationForm
                  organizationId={organizationId}
                  customers={customers}
                  locations={locations.map((location) => ({ id: location.id, label: location.label }))}
                />
              </Disclosure>
            ) : null}

            <div>
              <LocationTable
                organizationId={organizationId}
                locations={visibleLocations}
                definitions={definitions}
                mayEdit={mayAdd}
                mayLookUp={geocoding !== null}
              />
            </div>
          </>
        ) : (
          <LocationMapLoader
            organizationId={organizationId}
            locations={visibleLocations}
            mapStyleUrl={styleUrl}
            mayEdit={mayAdd}
            mayLookUp={geocoding !== null}
          />
        )}
      </CreateLocationSheetProvider>
    </AppPage>
  );
}
