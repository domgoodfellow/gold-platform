'use client';

import { TextArea, TextInput } from '@/components/controls/inputs';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { FormError, FormField } from '@/components/controls/form';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { usePageDrawerUnsavedChanges } from '@/components/panels/page-drawer';
import { useActionState, useEffect, useState } from 'react';
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
import { SelectField } from '@/components/controls/select-field';

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
  formId,
  onCreated,
  onPendingChange,
}: {
  organizationId: string;
  /** Locks the field to one entity — used where a scoped configuration surface (e.g. Work's
   * Fields tab) must not let someone define a field on a different entity from inside it. Left
   * undefined for the general, cross-entity Settings surface, which still offers the choice. */
  entityType: CustomFieldEntity;
  /** The id a footer submit button names with `form=` — the drawer owns the button. */
  formId: string;
  onCreated?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(createFieldAction, INITIAL);
  // The one piece of state on this screen, and it buys one thing: the choices box appears when
  // a kind that offers choices is selected. Rendering it always would ask every business to
  // think about choices while defining a number.
  const [kind, setKind] = useState<FieldKind>('text');
  const { ref, dirty, onChange } = useFormDirty();
  usePageDrawerUnsavedChanges(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending, onPendingChange);

  useEffect(() => {
    if (state.created) onCreated?.();
  }, [state.created, onCreated]);

  const labelId = `${formId}-label`;
  const keyId = `${formId}-key`;
  const kindId = `${formId}-kind`;
  const optionsId = `${formId}-options`;
  const requiredId = `${formId}-required`;

  return (
    <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="flex flex-col gap-4">
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
            <SelectField {...field} name="kind" value={kind} onValueChange={(next) => setKind(next as FieldKind)} options={[...FIELD_KINDS.map((option) => ({ value: option, label: FIELD_KIND_LABELS[option] }))]} />
          )}
        </FormField>
      </div>

      {offersOptions(kind) ? <OptionsInput id={optionsId} name="options" /> : null}

      <CheckboxField id={requiredId} name="required" label="Required" />

      <div ref={errorRef} tabIndex={-1} className="outline-none">
        <FormError>{state.error}</FormError>
      </div>
    </form>
  );
}

/**
 * Editing one field, inside its drawer.
 *
 * A position is still a number typed here, as on the work board's `EditStatusForm`; an ordered
 * list that replaces it is a separate, shared control.
 *
 * The key and the kind are not inputs: the drawer shows them as metadata. That is not a disabled
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
  formId,
  onUpdated,
  onPendingChange,
}: {
  organizationId: string;
  definition: FieldDefinition;
  /** The id a footer submit button names with `form=` — the drawer owns the button. */
  formId: string;
  onUpdated?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(updateFieldAction, EDIT_INITIAL);
  const { ref, dirty, onChange } = useFormDirty();
  usePageDrawerUnsavedChanges(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending, onPendingChange);

  useEffect(() => {
    if (state.updated) onUpdated?.();
  }, [state.updated, onUpdated]);

  const labelId = `${formId}-label`;
  const positionId = `${formId}-position`;
  const optionsId = `${formId}-options`;
  const requiredId = `${formId}-required`;

  return (
    <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="fieldId" value={definition.id} />
      <input type="hidden" name="kind" value={definition.kind} />
      <input type="hidden" name="entityType" value={definition.entityType} />

      <FormField id={labelId} label="Label">
        {(field) => <TextInput {...field} name="label" type="text" required maxLength={100} defaultValue={definition.label} />}
      </FormField>
      <FormField id={positionId} label="Position" hint="Lower numbers appear first.">
        {(field) => <TextInput {...field} name="position" type="number" required min={0} step={1} defaultValue={definition.position} className="w-28" />}
      </FormField>
      <CheckboxField id={requiredId} name="required" label="Required" defaultChecked={definition.required} />

      {offersOptions(definition.kind) ? (
        <OptionsInput id={optionsId} name="options" defaultValue={definition.options} />
      ) : null}

      <div ref={errorRef} tabIndex={-1} className="outline-none">
        <FormError>{state.error}</FormError>
      </div>
    </form>
  );
}
