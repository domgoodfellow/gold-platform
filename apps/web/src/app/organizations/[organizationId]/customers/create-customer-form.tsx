'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createCustomerAction, type CreateCustomerState } from './actions';

const INITIAL: CreateCustomerState = { error: null };

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';

export function CreateCustomerForm({
  organizationId,
  definitions,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createCustomerAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">New customer</h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="Name"
          aria-label="Name"
          className={INPUT_CLASS}
        />
        <input
          name="email"
          type="email"
          placeholder="Email (optional)"
          aria-label="Email"
          className={INPUT_CLASS}
        />
        <input
          name="phone"
          type="tel"
          placeholder="Phone (optional)"
          aria-label="Phone"
          className={INPUT_CLASS}
        />
      </div>

      <CustomFieldInputs definitions={definitions} />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add customer'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
