import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { CreateOrganizationForm } from './create-organization-form';

export const dynamic = 'force-dynamic';

export default async function OrganizationsPage() {
  const db = await getDb();

  try {
    await requireActor(db);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Organizations</h1>
          <p className="mt-4 text-sm opacity-70">Sign in to see your organizations.</p>
        </main>
      );
    }
    throw error;
  }

  const organizations = await listMyOrganizations(db);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Organizations</h1>

      {organizations.length === 0 ? (
        <p className="mt-4 text-sm opacity-70">
          You do not belong to an organization yet.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {organizations.map((organization) => (
            <li key={organization.id} className="flex items-baseline justify-between py-3">
              <span className="font-medium">{organization.name}</span>
              <span className="text-sm opacity-70">{organization.role}</span>
            </li>
          ))}
        </ul>
      )}

      <CreateOrganizationForm />
    </main>
  );
}
