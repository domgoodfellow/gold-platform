import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  FIELD_KIND_LABELS,
  listFieldDefinitions,
  type CustomFieldEntity,
  type FieldDefinition,
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

  // One query per entity that can carry fields, driven by the vocabulary rather than by a
  // hand-kept list here — so an entity added in a later migration appears on this screen
  // without anyone remembering to extend it.
  const byEntity = await Promise.all(
    CUSTOM_FIELD_ENTITIES.map(async (entityType): Promise<[CustomFieldEntity, FieldDefinition[]]> => [
      entityType,
      await listFieldDefinitions(db, { organizationId, entityType }),
    ]),
  );

  const mayManage = organization.capabilities.includes('field.manage');
  const total = byEntity.reduce((sum, [, definitions]) => sum + definitions.length, 0);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/organizations" className="text-sm underline underline-offset-4 opacity-70">
        ← Organizations
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Custom fields</h1>
      <p className="text-sm opacity-70">{organization.name}</p>

      {total === 0 ? (
        <p className="mt-6 text-sm opacity-70">
          No custom fields yet. Anything you define here appears on that entity&apos;s form.
        </p>
      ) : (
        byEntity
          .filter(([, definitions]) => definitions.length > 0)
          .map(([entityType, definitions]) => (
            <section key={entityType} className="mt-6">
              <h2 className="text-sm font-medium">{CUSTOM_FIELD_ENTITY_LABELS[entityType]}</h2>
              <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
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
            </section>
          ))
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
