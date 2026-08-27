'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createResourceAction, type CreateResourceState } from './actions';

const INITIAL: CreateResourceState = { error: null };

export function CreateResourceForm({
  organizationId,
  definitions,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createResourceAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">New resource</h2>

      <input
        name="name"
        type="text"
        required
        maxLength={200}
        placeholder="Name, e.g. Sam Okafor, or Van 3"
        aria-label="Name"
        className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
      />

      <CustomFieldInputs definitions={definitions} />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add resource'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
