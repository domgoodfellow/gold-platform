'use client';

import { useActionState } from 'react';
import { CurrencyField, TimeZoneField } from '@/components/locale-fields';
import { createOrganizationAction, type CreateOrganizationState } from './actions';

const INITIAL: CreateOrganizationState = { error: null };

const INPUT_CLASS = 'rounded border border-black/15 px-3 py-2 dark:border-white/20';

/**
 * Founding a business asks four things, and each is a decision the platform refuses to make.
 *
 * The zone and the currency were a hidden input and a bare three-letter box: the first
 * assumed the founder's browser was the business's clock without saying so, and the second
 * asked for a code with no way to find out which. Both are now offered from ICU, and neither
 * is derived from the other — a Dutch company invoicing in dollars is ordinary, so a
 * country-to-currency guess would be the platform deciding what a business trades in.
 */
export function CreateOrganizationForm() {
  const [state, formAction, pending] = useActionState(createOrganizationAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      <h2 className="text-sm font-medium">New organization</h2>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            What is it called?
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="Northern Plant Services"
            className={INPUT_CLASS}
          />
        </div>

        {/* What this organization will call you. Per-tenant, never a global profile (D19) —
            the founder is not a special case, they are its first membership. */}
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="displayName" className="text-sm font-medium">
            What should it call you?
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            maxLength={120}
            placeholder="Sam Okafor"
            className={INPUT_CLASS}
          />
          <p className="text-xs opacity-60">
            Only this business sees this name. Another one can know you by a different one.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <TimeZoneField />
        <CurrencyField />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
