'use client';

import { useActionState } from 'react';

export type PortalLinkState = { error: string | null; token: string | null };

/**
 * The operator's side of a portal link.
 *
 * **The token is shown, not hidden.** It is a shareable link rather than a password: a business
 * that has lost the one it sent has to be able to send the same one again, and hiding it would
 * only mean issuing a second. What protects a customer is that the business can withdraw it,
 * which is the control this screen actually needs to offer.
 *
 * Lives in `features/` beside the public profile because both are the same job — what this
 * business shows people outside it — and neither belongs to the route that happens to render
 * it today.
 */
export function PortalLinkForm({
  organizationId,
  customerId,
  origin,
  createAction,
}: {
  organizationId: string;
  customerId: string;
  origin: string;
  createAction: (previous: PortalLinkState, formData: FormData) => Promise<PortalLinkState>;
}) {
  const [state, formAction, pending] = useActionState(createAction, {
    error: null,
    token: null,
  });

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="customerId" value={customerId} />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
      >
        {pending ? 'Making a link…' : 'Make a portal link'}
      </button>

      {state.token ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">Send this to the customer. Anyone holding it is them.</span>
          <input
            readOnly
            value={`${origin}/portal/${state.token}`}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded border border-black/15 px-3 py-2 font-mono text-xs dark:border-white/20"
          />
        </label>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
