'use client';

import { SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { useActionState, useEffect, useId, useState } from 'react';
import {
  FIELD_KINDS,
  FIELD_KIND_LABELS,
  offersOptions,
  type CustomFieldEntity,
  type FieldKind,
} from '@/lib/domain/fields/field-definitions';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createFieldAction,
  updateFieldAction,
  type CreateFieldState,
  type UpdateFieldState,
} from '@/app/organizations/[organizationId]/settings/custom-fields/actions';

const INITIAL: CreateFieldState = { error: null, created: false };
const EDIT_INITIAL: UpdateFieldState = { error: null, updated: false };

/**
 * The choices, one per line.
 *
 * **A textarea rather than a repeating row of inputs**, which is the whole reason this is
 * three lines instead of a component with add and remove buttons: a business writing down its
 * service levels is writing a list, and a list is what a textarea already is. Reordering is
 * moving a line. Nothing here needs state, so nothing here has any.
 *
 * The order somebody types is the order the dropdown offers, because `options` is an array and
 * arrays keep their order. That is the same promise `position` makes about the form itself.
 */
export function OptionsInput({ id, name, defaultValue }: { id: string; name: string; defaultValue?: string[] }) {
  return (
    <FormField
      id={id}
      label="Choices"
      hint="One per line, in the order they should appear. Removing one leaves it on records that already have it."
    >
      {(field) => (
        <TextArea
          {...field}
          name={name}
          rows={4}
          defaultValue={defaultValue?.join('\n')}
          placeholder={'One choice per line, e.g.\nStandard\nPriority'}
        />
      )}
    </FormField>
  );
}

export function CreateFieldForm({
  organizationId,
  entityType,
  onCreated,
}: {
  organizationId: string;
  /** Locks the field to one entity — used where a scoped configuration surface (e.g. Work's
   * Fields tab) must not let someone define a field on a different entity from inside it. Left
   * undefined for the general, cross-entity Settings surface, which still offers the choice. */
  entityType: CustomFieldEntity;
  onCreated?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createFieldAction, INITIAL);
  // The one piece of state on this screen, and it buys one thing: the choices box appears when
  // a kind that offers choices is selected. Rendering it always would ask every business to
  // think about choices while defining a number.
  const [kind, setKind] = useState<FieldKind>('text');

  useEffect(() => {
    if (state.created) onCreated?.();
  }, [state.created, onCreated]);

  const formId = useId();
  const labelId = `${formId}-label`;
  const keyId = `${formId}-key`;
  const kindId = `${formId}-kind`;
  const optionsId = `${formId}-options`;
  const requiredId = `${formId}-required`;

  return (
    <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="entityType" value={entityType} />

      <div className="flex flex-col gap-3">
        <FormField id={labelId} label="Label">
          {(field) => (
            <TextInput
              {...field}
              name="label"
              type="text"
              required
              maxLength={100}
              placeholder="e.g. VAT number"
            />
          )}
        </FormField>
        <FormField id={keyId} label="Key">
          {(field) => (
            <TextInput
              {...field}
              name="key"
              type="text"
              required
              maxLength={63}
              pattern="[a-z][a-z0-9_]*"
              placeholder="e.g. vat_number"
              title="Starts with a letter; lowercase letters, numbers and underscores only."
            />
          )}
        </FormField>
        <FormField id={kindId} label="Type">
          {(field) => (
            <SelectInput
              {...field}
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as FieldKind)}
            >
              {FIELD_KINDS.map((option) => (
                <option key={option} value={option}>
                  {FIELD_KIND_LABELS[option]}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      </div>

      {offersOptions(kind) ? <OptionsInput id={optionsId} name="options" /> : null}

      <CheckboxField id={requiredId} name="required" label="Required" />

      <FormActions>
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? 'Adding…' : 'Add field'}
        </Button>
      </FormActions>

      <FormError>{state.error}</FormError>
    </form>
  );
}

/**
 * One row of the form a tenant is arranging.
 *
 * The same shape as `EditStatusForm` on the work board, deliberately: an operator who has
 * reordered their statuses already knows that a position is a number they type. Extracting
 * the two into a shared control is M3's job at the point a *third* screen wants it, which
 * `roadmap.md` says explicitly and which two screens do not yet justify.
 *
 * The key and the kind are rendered as text rather than as inputs. That is not a disabled
 * control standing in for a permission — the column grant refuses both to everybody, so
 * there is no version of this form, for any role, in which they are editable.
 *
 * **The choices are on this row and not behind a second form**, because a form that saves
 * label, required and position while leaving options to somewhere else is a save that wipes
 * them: `update_field_definition` writes the whole row, so a field submitted without its
 * choices is a field with no choices. Rendering them here is what makes that impossible — the
 * box is always populated with what the field currently offers.
 *
 * The kind is sent as a hidden field so the domain layer knows whether options mean anything.
 * It is not writable and does not become writable by travelling: the column grant refuses
 * `kind`, and the check constraint reads the stored one, so a tampered value is refused by the
 * database rather than believed here.
 */
export function EditFieldForm({
  organizationId,
  definition,
  onUpdated,
}: {
  organizationId: string;
  definition: FieldDefinition;
  onUpdated?: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateFieldAction, EDIT_INITIAL);

  useEffect(() => {
    if (state.updated) onUpdated?.();
  }, [state.updated, onUpdated]);

  const formId = useId();
  const optionsId = `${formId}-options`;
  const requiredId = `${formId}-required`;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 py-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="fieldId" value={definition.id} />
      <input type="hidden" name="kind" value={definition.kind} />
      <input type="hidden" name="entityType" value={definition.entityType} />

      <TextInput
        name="position"
        type="number"
        required
        min={0}
        step={1}
        defaultValue={definition.position}
        aria-label={`Position of ${definition.label}`}
        size="small"
        className="w-16"
      />
      <TextInput
        name="label"
        type="text"
        required
        maxLength={100}
        defaultValue={definition.label}
        aria-label={`Label of ${definition.label}`}
        size="small"
        className="min-w-0 flex-1"
      />
      <code className="text-xs text-subtle">
        {definition.key} · {FIELD_KIND_LABELS[definition.kind]}
      </code>
      <CheckboxField id={requiredId} name="required" label="Required" defaultChecked={definition.required} />
      <Button type="submit" disabled={pending} tone="secondary" size="tiny">
        Save
      </Button>

      {offersOptions(definition.kind) ? (
        <div className="w-full">
          <OptionsInput id={optionsId} name="options" defaultValue={definition.options} />
        </div>
      ) : null}

      <FormError className="w-full">{state.error}</FormError>
    </form>
  );
}
