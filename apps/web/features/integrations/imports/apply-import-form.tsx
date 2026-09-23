'use client';

import { useActionState } from 'react';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { ErrorText } from '@/components/controls/inputs';
import {
  applyImportRunAction,
  type ApplyState,
} from '@/app/organizations/[organizationId]/integrations/imports/[runId]/actions';

const APPLY_INITIAL: ApplyState = { error: null };

export function ApplyImportForm({
  organizationId,
  runId,
  readyCount,
}: {
  organizationId: string;
  runId: string;
  readyCount: number;
}) {
  const [state, formAction, pending] = useActionState(applyImportRunAction, APPLY_INITIAL);
  const formId = `apply-${runId}`;

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="runId" value={runId} />
      <ConfirmSubmit
        formId={formId}
        label={`Import ${readyCount} customer${readyCount === 1 ? '' : 's'}`}
        confirmLabel={`Import ${readyCount} customer${readyCount === 1 ? '' : 's'}?`}
        description="Rows marked Review, Duplicate or Invalid are skipped and stay exactly as they are — nothing about them is written."
        tone="primary"
        size="default"
        pending={pending}
      />
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}
