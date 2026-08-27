'use client';

import { useActionState } from 'react';
import { FIELD_KINDS, FIELD_KIND_LABELS } from '@/lib/domain/fields/field-definitions';
import { createFieldAction, type CreateFieldState } from './actions';

const INITIAL: CreateFieldState = { error: null };

export function CreateFieldForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createFieldAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">New field</h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="label"
          type="text"
          required
          maxLength={100}
          placeholder="Label, e.g. VAT number"
          aria-label="Label"
          className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20"
        />
        <input
          name="key"
          type="text"
          required
          maxLength={63}
          pattern="[a-z][a-z0-9_]*"
          placeholder="Key, e.g. vat_number"
          aria-label="Key"
          title="Starts with a letter; lowercase letters, numbers and underscores only."
          className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20"
        />
        <select
          name="kind"
          defaultValue="text"
          aria-label="Type"
          className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
        >
          {FIELD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {FIELD_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      <label className="flex w-fit items-center gap-2 text-sm">
        <input name="required" type="checkbox" />
        Required
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add field'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
