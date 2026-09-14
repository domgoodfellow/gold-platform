import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { PageHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { listAssets } from '@/lib/domain/assets/assets';
import { listAssetReadings } from '@/lib/domain/assets/readings';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { requireOrganization } from '@/lib/route/organization';
import { recordReadingAction } from './actions';
import { CreateAssetSheetProvider, CreateAssetTrigger } from './create-asset-sheet';
import { RecordReadingForm } from './create-asset-form';

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

  // The latest reading per asset, which is what somebody looking at the list wants — the rest of
  // the log lives under the asset. One query per asset is honest at this size; a list that grows
  // past a screenful is what would make this a join worth writing.
  const readings = new Map(
    await Promise.all(
      assets.map(async (asset) => {
        const own = await listAssetReadings(db, {
          organizationId,
          assetId: asset.id,
          limit: 1,
        });
        return [asset.id, own[0] ?? null] as const;
      }),
    ),
  );

  const customerOptions = customers.map((c) => ({ id: c.id, label: c.name }));
  const locationOptions = locations.map((l) => ({ id: l.id, label: l.label }));

  return (
    <AppPage width="wide">
      <CreateAssetSheetProvider
        organizationId={organizationId}
        customers={customerOptions}
        locations={locationOptions}
        definitions={definitions}
      >
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <PageHeading>Assets</PageHeading>
            <Hint className="mt-1">
              What work is about — machines, vehicles, properties, customer-owned equipment.
            </Hint>
          </div>
          {/*
            Hiding the trigger is a courtesy, not the guard. `assets_insert` requires
            asset.create in the database (constraints.md: hiding a UI element is not
            authorization).
          */}
          {mayAdd ? <CreateAssetTrigger /> : null}
        </header>

        <div className="mt-6">
          <DataTable
            rows={assets}
            rowKey={(asset) => asset.id}
            empty="No assets yet."
            emptyAction={mayAdd ? <CreateAssetTrigger /> : undefined}
            // **Recording a reading is the action a list of assets implies**, which is why it is
            // the row action rather than a form under every entry. Nothing is assumed about what
            // a counter counts — hours, miles, cycles — and a machine nobody meters has none.
            actions={
              mayAdd
                ? (asset) => (
                    <RecordReadingForm
                      organizationId={organizationId}
                      assetId={asset.id}
                      assetName={asset.name}
                      lastUnit={readings.get(asset.id)?.unit ?? ''}
                      action={recordReadingAction}
                    />
                  )
                : undefined
            }
            columns={[
              {
                key: 'name',
                header: 'Asset',
                emphasis: 'primary',
                cell: (asset) => (
                  <Link
                    href={`/organizations/${organizationId}/assets/${asset.id}`}
                    className="underline underline-offset-4"
                  >
                    {asset.name}
                  </Link>
                ),
              },
              {
                key: 'where',
                header: 'Whose, and where',
                cell: (asset) =>
                  [
                    asset.customer ? `Owned by ${asset.customer.label}` : null,
                    asset.location ? `at ${asset.location.label}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || null,
              },
              {
                key: 'reading',
                header: 'Last read',
                cell: (asset) => {
                  const reading = readings.get(asset.id);
                  if (!reading) return <span className="text-subtle">—</span>;
                  return (
                    <span className="tabular-nums">
                      {reading.value} {reading.unit}
                      <span className="text-muted">
                        {' '}
                        · {new Date(reading.readAt).toLocaleDateString('en-GB')}
                      </span>
                    </span>
                  );
                },
              },
              ...(definitions.length > 0
                ? [
                    {
                      key: 'custom',
                      header: 'Details',
                      emphasis: 'secondary' as const,
                      cell: (asset: (typeof assets)[number]) => (
                        <CustomFieldValues definitions={definitions} custom={asset.custom} />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </CreateAssetSheetProvider>
    </AppPage>
  );
}
