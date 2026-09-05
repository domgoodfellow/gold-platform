import { Hint } from '@/components/controls/inputs';
import { Disclosure } from '@/components/containers/card';
import { DividedList, EmptyState, SectionHeading } from '@/components/containers/section';
import { requireOrganization } from '@/lib/route/organization';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  FIELD_KIND_LABELS,
  listFieldDefinitions,
  type CustomFieldEntity,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { CreateFieldForm, EditFieldForm } from './create-field-form';

export const dynamic = 'force-dynamic';

export default async function FieldsPage({
  params,
}: PageProps<'/organizations/[organizationId]/fields'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

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
    <>
      {total === 0 ? (
        <EmptyState className="mt-6">
          No custom fields yet. Anything you define here appears on that entity&apos;s form.
        </EmptyState>
      ) : (
        byEntity
          .filter(([, definitions]) => definitions.length > 0)
          .map(([entityType, definitions]) => (
            <section key={entityType} className="mt-6">
              <SectionHeading>{CUSTOM_FIELD_ENTITY_LABELS[entityType]}</SectionHeading>
              {/* In the tenant's own order, which is the order the entity's form renders
                  in. Editing the number here is what "custom forms" means on this screen —
                  there is no separate form designer, because the registry *is* the form. */}
              <DividedList className="mt-2">
                {definitions.map((definition) => (
                  <li key={definition.id}>
                    {mayManage ? (
                      <EditFieldForm
                        organizationId={organizationId}
                        definition={definition}
                      />
                    ) : (
                      <div className="py-3">
                        <div className="font-medium">{definition.label}</div>
                        <div className="text-sm text-muted">
                          {[
                            definition.key,
                            FIELD_KIND_LABELS[definition.kind],
                            definition.required ? 'Required' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </DividedList>
            </section>
          ))
      )}

      {/*
        Hiding the form is a courtesy, not the guard. `field_definitions_insert` requires
        field.manage in the database, so a caller who reaches the action anyway is refused
        there (constraints.md: hiding a UI element is not authorization).
      */}
      {mayManage ? (
        <Disclosure summary="Define a field" defaultOpen={total === 0} className="mt-8">
          <CreateFieldForm organizationId={organizationId} />
        </Disclosure>
      ) : (
        <Hint className="mt-8">
          Your role, {organization.role}, cannot define fields here.
        </Hint>
      )}
    </>
  );
}
