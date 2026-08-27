import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  FIELD_KIND_LABELS,
  listFieldDefinitions,
} from '@/lib/domain/fields/field-definitions';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { CreateFieldForm } from './create-field-form';

export const dynamic = 'force-dynamic';

export default async function FieldsPage({
  params,
}: PageProps<'/organizations/[organizationId]/fields'>) {
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

  const definitions = await listFieldDefinitions(db, {
    organizationId,
    entityType: 'customer',
  });
  const mayManage = organization.capabilities.includes('field.manage');

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Customer fields</h1>
      <p className="text-sm opacity-70">{organization.name}</p>

      {definitions.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">
          No custom fields yet. Anything you define here appears on every customer form.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-black/10 dark:divide-white/15">
          {definitions.map((definition) => (
            <li key={definition.id} className="py-3">
              <div className="font-medium">{definition.label}</div>
              <div className="text-sm opacity-70">
                {[
                  definition.key,
                  FIELD_KIND_LABELS[definition.kind],
                  definition.required ? 'Required' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
        Hiding the form is a courtesy, not the guard. `field_definitions_insert` requires
        field.manage in the database, so a caller who reaches the action anyway is refused
        there (constraints.md: hiding a UI element is not authorization).
      */}
      {mayManage ? (
        <CreateFieldForm organizationId={organizationId} />
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot define fields here.
        </p>
      )}
    </main>
  );
}
