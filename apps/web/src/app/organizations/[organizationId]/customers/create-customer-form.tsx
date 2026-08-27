'use client';

import { useActionState } from 'react';
import {
  CUSTOM_FIELD_PREFIX,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';
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

      {/*
        Whatever this tenant has defined, rendered from its own registry. `required` here is
        the browser being helpful; the rule is re-checked in the domain layer and again by
        app.check_custom_fields, because a form attribute is not a constraint.
      */}
      {definitions.map((definition) => {
        const name = `${CUSTOM_FIELD_PREFIX}${definition.key}`;

        if (definition.kind === 'boolean') {
          return (
            <label key={definition.id} className="flex w-fit items-center gap-2 text-sm">
              <input name={name} type="checkbox" />
              {definition.label}
            </label>
          );
        }

        return (
          <input
            key={definition.id}
            name={name}
            type={definition.kind === 'number' ? 'number' : 'text'}
            step={definition.kind === 'number' ? 'any' : undefined}
            required={definition.required}
            placeholder={definition.required ? definition.label : `${definition.label} (optional)`}
            aria-label={definition.label}
            className={INPUT_CLASS}
          />
        );
      })}

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
