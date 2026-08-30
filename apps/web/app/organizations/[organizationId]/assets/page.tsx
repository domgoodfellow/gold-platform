import { CustomFieldValues } from '@/components/custom-field-values';
import { listAssets } from '@/lib/domain/assets/assets';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { requireOrganization } from '@/lib/route/organization';
import { CreateAssetForm } from './create-asset-form';

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

  return (
    <>
      <p className="text-sm opacity-70">
        What work is about — machines, vehicles, properties, customer-owned equipment.
      </p>

      {assets.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No assets yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {assets.map((asset) => (
            <li key={asset.id} className="py-3">
              <div className="font-medium">{asset.name}</div>
              {asset.customer || asset.location ? (
                <div className="text-sm opacity-70">
                  {[
                    asset.customer ? `Owned by ${asset.customer.label}` : null,
                    asset.location ? `at ${asset.location.label}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              ) : null}
              <CustomFieldValues definitions={definitions} custom={asset.custom} />
            </li>
          ))}
        </ul>
      )}

      {/*
        Hiding the form is a courtesy, not the guard. `assets_insert` requires asset.create in
        the database (constraints.md: hiding a UI element is not authorization).
      */}
      {mayAdd ? (
        <CreateAssetForm
          organizationId={organizationId}
          customers={customers.map((c) => ({ id: c.id, label: c.name }))}
          locations={locations.map((l) => ({ id: l.id, label: l.label }))}
          definitions={definitions}
        />
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot add assets here.
        </p>
      )}
    </>
  );
}
