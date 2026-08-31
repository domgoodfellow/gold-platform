'use client';

import { useActionState } from 'react';
import { CurrencyField, TimeZoneField } from '@/components/locale-fields';
import { provisionOrganizationAction, type ProvisionState } from './actions';

const INITIAL: ProvisionState = { error: null, provisioned: null };

const INPUT_CLASS = 'rounded border border-black/15 px-3 py-2 dark:border-white/20';

/**
 * Handing a business over, which is what actually happens at the end of a sales call.
 *
 * It asks the same four things `CreateOrganizationForm` asks, plus the one that makes it the
 * operator door rather than the other one: **whose business it is**. The staff member filling
 * this in is not going to be a member of what they create.
 *
 * **The two forms are not extracted into one shared control, and that is D23 rather than an
 * oversight** — a component is extracted at the third caller. There are two, they ask different
 * questions of different people, and folding them together now would produce one form with a
 * mode flag, which is the shape D29 spent a record arguing against at the layer below this one.
 */
export function ProvisionForm() {
  const [state, formAction, pending] = useActionState(provisionOrganizationAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-4">
      <h2 className="text-sm font-medium">Provision a business</h2>

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

        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="ownerEmail" className="text-sm font-medium">
            Who does it belong to?
          </label>
          <input
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            required
            placeholder="sam@northernplant.example"
            className={INPUT_CLASS}
          />
          {/*
            The precondition is real and is stated rather than discovered: a membership
            references `auth.users`, so the owner has to have signed up. It is the same thing
            `addMember` says, and creating the account for them would need the admin API, which
            this app may not hold.
          */}
          <p className="text-xs opacity-60">
            They need an account already — ask them to sign up first.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="displayName" className="text-sm font-medium">
            What should it call them?
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
            Only this business sees this name (D19).
          </p>
        </div>

        {/*
          UTC rather than our own zone. `TimeZoneField` preselects the reader's browser zone,
          which is the right answer when somebody founds their own business and the wrong one
          here — the browser belongs to us, and a business in Montreal would arrive on a London
          clock because of where a staff member happened to be sitting (I9).
        */}
        <TimeZoneField defaultValue="UTC" label="Where is the business?" />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <CurrencyField />
        <div className="flex-1" />
      </div>

      {state.error ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      {state.provisioned ? (
        <p className="text-sm opacity-70">
          {state.provisioned} exists and belongs to its owner. It is empty — no statuses, no
          types, no hours — which is the next conversation rather than a fault.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? 'Provisioning…' : 'Provision'}
      </button>
    </form>
  );
}
