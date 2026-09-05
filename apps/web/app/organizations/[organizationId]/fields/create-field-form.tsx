'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  FIELD_KINDS,
  FIELD_KIND_LABELS,
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
export function CreateFieldForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createFieldAction, INITIAL);

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
        <SelectInput name="kind" defaultValue="text" aria-label="Type">
          {FIELD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {FIELD_KIND_LABELS[kind]}
            </option>
          ))}
        </SelectInput>
      </div>

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

      <ErrorText role="alert" className="w-full">{state.error}</ErrorText>
    </form>
  );
}
