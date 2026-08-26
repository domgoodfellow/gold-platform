import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { listCustomers } from '@/lib/domain/customers/customers';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { CreateCustomerForm } from './create-customer-form';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  params,
}: PageProps<'/organizations/[organizationId]/customers'>) {
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

  // Another tenant's organization id resolves to null here, so this renders a 404 rather
  // than an empty customer list. Both are safe; a 404 is honest, because from this caller's
  // position the organization genuinely does not exist.
  const organization = await getOrganization(db, organizationId);
  if (!organization) {
    notFound();
  }

  const customers = await listCustomers(db, { organizationId });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Customers</h1>
      <p className="text-sm opacity-70">{organization.name}</p>

      {customers.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">No customers yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {customers.map((customer) => (
            <li key={customer.id} className="py-3">
              <div className="font-medium">{customer.name}</div>
              {customer.email || customer.phone ? (
                <div className="text-sm opacity-70">
                  {[customer.email, customer.phone].filter(Boolean).join(' · ')}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <CreateCustomerForm organizationId={organizationId} />
    </main>
  );
}
