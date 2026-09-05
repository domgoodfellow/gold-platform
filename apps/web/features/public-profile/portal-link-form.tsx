'use client';

import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
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

      <Button type="submit" disabled={pending} tone="secondary" size="small" className="w-fit">
        {pending ? 'Making a link…' : 'Make a portal link'}
      </Button>

      {state.token ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Send this to the customer. Anyone holding it is them.</span>
          <TextInput
            readOnly
            value={`${origin}/portal/${state.token}`}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full font-mono text-xs"
          />
        </label>
      ) : null}

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
