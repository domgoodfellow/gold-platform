import { AppPage } from '@/components/layout/app-page';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { AssetConfiguration } from '@/features/assets/configuration/asset-configuration';
import { AssetTable } from '@/features/assets/asset-table';
import { CreateAssetSheetProvider, CreateAssetTrigger } from '@/features/assets/create-asset-sheet';
import { listAssets } from '@/lib/domain/assets/assets';
import { listLatestAssetReadings } from '@/lib/domain/assets/readings';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { recordReadingAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AssetsPage({
  params,
}: PageProps<'/organizations/[organizationId]/assets'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [assets, customers, locations, definitions] = await Promise.all([
    listAssets(db, { organizationId }),
    listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'asset' }),
  ]);

  const mayAdd = organization.capabilities.includes('asset.create');
  const mayConfigure = organization.capabilities.includes('field.manage');

  // One query for every visible asset's newest reading, not one query per asset.
  const latestReadings = await listLatestAssetReadings(db, {
    organizationId,
    assetIds: assets.map((asset) => asset.id),
  });

  const customerOptions = customers.map((c) => ({ id: c.id, label: c.name }));
  const locationOptions = locations.map((l) => ({ id: l.id, label: l.label }));

  return (
    <AppPage>
      <CreateAssetSheetProvider
        organizationId={organizationId}
        customers={customerOptions}
        locations={locationOptions}
        definitions={definitions}
      >
        {/*
          Hiding the trigger is a courtesy, not the guard. `assets_insert` requires
          asset.create in the database (`docs/security.md`: hiding a UI element is not
          authorization).
        */}
        <CollectionHeader
          title={areaLabel('assets')}
          crumbs={workspaceAncestry(organizationId, 'assets')}
          actions={mayAdd ? <CreateAssetTrigger /> : null}
          configure={mayConfigure}
        />
        {mayConfigure ? (
          <ConfigureRegistrar
            title="Assets configuration"
            settingsHref={`/organizations/${organizationId}/settings/custom-fields`}
          >
            <AssetConfiguration
              organizationId={organizationId}
              role={organization.role}
              mayConfigure={mayConfigure}
              definitions={definitions}
            />
          </ConfigureRegistrar>
        ) : null}
        <div>
          <AssetTable
            organizationId={organizationId}
            assets={assets}
            latestReadings={latestReadings}
            definitions={definitions}
            mayRecord={mayAdd}
            recordReadingAction={recordReadingAction}
          />
        </div>
      </CreateAssetSheetProvider>
    </AppPage>
  );
}
