import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CustomFieldValues } from '@/components/custom-field-values';
import { getDb } from '@/lib/db/server';
import { listAssets } from '@/lib/domain/assets/assets';
import { listCustomers } from '@/lib/domain/customers/customers';
import { DomainError } from '@/lib/domain/errors';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { CreateAssetForm } from './create-asset-form';

export const dynamic = 'force-dynamic';

export default async function AssetsPage({
  params,
}: PageProps<'/organizations/[organizationId]/assets'>) {
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

  const [assets, customers, locations, definitions] = await Promise.all([
    listAssets(db, { organizationId }),
    listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'asset' }),
  ]);

  const mayAdd = organization.capabilities.includes('asset.create');

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Assets</h1>
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
    </main>
  );
}
