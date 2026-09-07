'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, useState } from 'react';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  FIELD_KINDS,
  FIELD_KIND_LABELS,
  offersOptions,
  type FieldKind,
} from '@/lib/domain/fields/field-definitions';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createFieldAction,
  updateFieldAction,
  type CreateFieldState,
  type UpdateFieldState,
} from './actions';

const INITIAL: CreateFieldState = { error: null };
const EDIT_INITIAL: UpdateFieldState = { error: null };

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
function OptionsInput({ name, defaultValue }: { name: string; defaultValue?: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <TextArea
        name={name}
        rows={4}
        defaultValue={defaultValue?.join('\n')}
        placeholder={'One choice per line, e.g.\nStandard\nPriority'}
        aria-label="Choices"
      />
      <Hint>
        One per line, in the order they should appear. Removing one leaves it on records that
        already have it.
      </Hint>
    </div>
  );
}

export function CreateFieldForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createFieldAction, INITIAL);
  // The one piece of state on this screen, and it buys one thing: the choices box appears when
  // a kind that offers choices is selected. Rendering it always would ask every business to
  // think about choices while defining a number.
  const [kind, setKind] = useState<FieldKind>('text');

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>New field</SectionHeading>

      <SelectInput
        name="entityType"
        defaultValue="customer"
        aria-label="Applies to"
        className="w-fit"
      >
        {CUSTOM_FIELD_ENTITIES.map((entity) => (
          <option key={entity} value={entity}>
            {CUSTOM_FIELD_ENTITY_LABELS[entity]}
          </option>
        ))}
      </SelectInput>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="label"
          type="text"
          required
          maxLength={100}
          placeholder="Label, e.g. VAT number"
          aria-label="Label"
          className="flex-1"
        />
        <TextInput
          name="key"
          type="text"
          required
          maxLength={63}
          pattern="[a-z][a-z0-9_]*"
          placeholder="Key, e.g. vat_number"
          aria-label="Key"
          title="Starts with a letter; lowercase letters, numbers and underscores only."
          className="flex-1"
        />
        <SelectInput
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as FieldKind)}
          aria-label="Type"
        >
          {FIELD_KINDS.map((option) => (
            <option key={option} value={option}>
              {FIELD_KIND_LABELS[option]}
            </option>
          ))}
        </SelectInput>
      </div>

      {offersOptions(kind) ? <OptionsInput name="options" /> : null}

      <label className="flex w-fit items-center gap-2 text-sm">
        <input name="required" type="checkbox" />
        Required
      </label>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add field'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
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
}: {
  organizationId: string;
  definition: FieldDefinition;
}) {
  const [state, formAction, pending] = useActionState(updateFieldAction, EDIT_INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 py-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="fieldId" value={definition.id} />
      <input type="hidden" name="kind" value={definition.kind} />

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
      <label className="flex items-center gap-1 text-sm">
        <input name="required" type="checkbox" defaultChecked={definition.required} />
        Required
      </label>
      <Button type="submit" disabled={pending} tone="secondary" size="tiny">
        Save
      </Button>

      {offersOptions(definition.kind) ? (
        <div className="w-full">
          <OptionsInput name="options" defaultValue={definition.options} />
        </div>
      ) : null}

      <ErrorText role="alert" className="w-full">{state.error}</ErrorText>
    </form>
  );
}
