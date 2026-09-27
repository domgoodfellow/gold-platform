import { Disclosure } from '@/components/containers/card';
import { AppPage } from '@/components/containers/app-page';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { PageHeader } from '@/components/containers/page-header';
import { LocationConfiguration } from '@/features/locations/configuration/location-configuration';
import { CreateLocationSheetProvider, CreateLocationTrigger } from '@/features/locations/create-location-sheet';
import { LinkCustomerLocationForm } from '@/features/locations/link-customer-location-form';
import { LocationTable } from '@/features/locations/location-table';
import { LocationMapLoader } from '@/features/locations/map/location-map-loader';
import { LocationsViewNav } from '@/features/locations/locations-view-nav';
import { resolveLocationsView } from '@/features/locations/locations-view';
import { geocodingProvider } from '@/lib/adapters/geocoding';
import { mapConfig } from '@/lib/adapters/maps/config';
import { listCustomers } from '@/lib/domain/customers/customers';
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
    listCustomers(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'location' }),
    geocodingProvider(),
  ]);

  const mayAdd = organization.capabilities.includes('location.create');
  const mayConfigure = organization.capabilities.includes('field.manage');
  const styleUrl = mapConfig()?.styleUrl ?? null;

  return (
    <AppPage>
      <CreateLocationSheetProvider organizationId={organizationId} definitions={definitions}>
        {/*
          Hiding the trigger is a courtesy, not the guard. `locations_insert` requires
          location.create in the database, so a caller who reaches the action anyway is
          refused there.
        */}
        <PageHeader
          title={areaLabel('locations')}
          crumbs={workspaceAncestry('locations')}
          description="Places where this organization works, and the customers they serve."
          actions={mayAdd ? <CreateLocationTrigger /> : null}
          configure={mayConfigure}
        />
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Locations configuration"
            settingsHref={`/organizations/${organizationId}/fields`}
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
                locations={locations}
                definitions={definitions}
                mayEdit={mayAdd}
                mayLookUp={geocoding !== null}
              />
            </div>
          </>
        ) : (
          <LocationMapLoader
            organizationId={organizationId}
            locations={locations}
            mapStyleUrl={styleUrl}
            mayEdit={mayAdd}
            mayLookUp={geocoding !== null}
          />
        )}
      </CreateLocationSheetProvider>
    </AppPage>
  );
}
