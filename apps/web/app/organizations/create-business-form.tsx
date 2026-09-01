'use client';

import { useActionState } from 'react';
import { CurrencyField, TimeZoneField } from '@/components/locale-fields';
import { createBusinessAction, type CreateBusinessState } from './actions';

const INITIAL: CreateBusinessState = { error: null };

const INPUT = 'w-full rounded border border-black/15 px-3 py-2 dark:border-white/20';

/**
 * Making your own business, on the day you sign up.
 *
 * **This is the screen that was missing, and its absence is what made signing up a dead end.**
 * Somebody registered, landed on a page telling them they belonged to no business, and had
 * nothing to press. Whatever the argument for closing this door was, that was the experience it
 * produced — and a person who cannot tell whether a product is broken, unfinished, or theirs to
 * fill in has been failed by it either way.
 *
 * Three fields and no more. A name, where you are, and what you charge in — the smallest set the
 * platform genuinely cannot work without, because every scheduled time is rendered in that zone
 * and every amount is recorded in that currency. Everything else this business is — what it
 * calls its work, its statuses, its prices, its people — is configured afterwards on screens that
 * already exist, and none of it is guessed at here.
 */
export function CreateBusinessForm() {
  const [state, formAction, pending] = useActionState(createBusinessAction, INITIAL);

  return (
    <form action={formAction} className="mt-6 flex max-w-md flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>What is your business called?</span>
        <input
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="Pneu3L"
          className={INPUT}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>And what should this business call you?</span>
        <input
          name="displayName"
          type="text"
          required
          maxLength={120}
          placeholder="Your name"
          className={INPUT}
        />
        <span className="text-xs opacity-70">
          {/* D19: a person's name here belongs to this business, not to a profile the platform
              owns. The same person can be called something different somewhere else. */}
          This is what colleagues here will see. It is not a profile — another business you join
          can call you something else.
        </span>
      </label>

      {/* The two controls the provisioning form uses, so there is one answer to "how does a
          business say where it is" rather than a picker in one place and a text box in the
          other. Whatever they offer, the database still checks the zone against the list
          Postgres itself keeps. */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <TimeZoneField label="Where is it?" />
        <CurrencyField />
      </div>

      <p className="text-sm opacity-70">
        Both can be changed later. Changing the currency does not reinterpret what past jobs cost
        and changing the zone does not move any booking — each amount carries the currency it was
        recorded in, and every scheduled time is an absolute instant.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create it'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
