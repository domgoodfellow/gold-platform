'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText } from '@/components/controls/inputs';
import {
  deleteSecretAction,
  setSecretStatusAction,
  type SecretFormState,
} from '@/app/organizations/[organizationId]/settings/secrets/actions';
import type { SecretReference } from '@/lib/domain/secrets/secret-references';

const INITIAL: SecretFormState = { error: null };

/** Disable keeps the value and refuses it to whatever asks; enable gives it back. Neither reveals anything. */
export function SecretStatusForm({ organizationId, reference }: { organizationId: string; reference: SecretReference }) {
  const [state, formAction, pending] = useActionState(setSecretStatusAction, INITIAL);
  const disabling = reference.status === 'active';

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="secretId" value={reference.id} />
      <input type="hidden" name="status" value={disabling ? 'disabled' : 'active'} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>
        {disabling ? 'Disable' : 'Enable'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function SecretDeleteForm({ organizationId, reference }: { organizationId: string; reference: SecretReference }) {
  const [state, formAction, pending] = useActionState(deleteSecretAction, INITIAL);
  const formId = `delete-secret-${reference.id}`;

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="secretId" value={reference.id} />
      <ConfirmSubmit
        formId={formId}
        label="Delete"
        confirmLabel={`Delete ${reference.key}?`}
        description="The stored value is destroyed and cannot be recovered. Anything that asks for this name will be told it is missing."
        tone="secondary"
        size="small"
        pending={pending}
        ariaLabel={`Delete ${reference.key}`}
      />
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
