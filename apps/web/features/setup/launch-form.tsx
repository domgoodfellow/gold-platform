'use client';

import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { useActionState } from 'react';
import { launchAction, type SetupActionState } from '@/app/organizations/[organizationId]/setup/actions';
import { Error } from './setup-controls';

const INITIAL: SetupActionState = { error: null };

/**
 * The one deliberate action that moves a business from Setup to Live. `launchOrganization`
 * re-checks readiness itself immediately before writing, so this form cannot launch a business
 * past a blocker the page merely rendered a moment earlier.
 */
export function LaunchForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(launchAction, INITIAL);

  return (
    <form id={`launch-${organizationId}`} action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <ConfirmSubmit formId={`launch-${organizationId}`} label="Finish setup" confirmLabel="Launch organization" tone="primary" pending={pending}
        description="This makes the organization Live and opens Home. Required setup is checked again before launch. You can continue changing configuration in Settings." />
      <Error state={state} />
    </form>
  );
}
