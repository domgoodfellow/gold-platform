'use client';

import { useActionState } from 'react';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText } from '@/components/controls/inputs';
import { IMPORT_BATCH_SIZE } from '@/lib/domain/integrations/import-policy';
import {
  applyImportRunAction,
  type ApplyState,
} from '@/app/organizations/[organizationId]/library/imports/[runId]/actions';

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
  const batchCount = Math.min(readyCount, IMPORT_BATCH_SIZE);

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="runId" value={runId} />
      <ConfirmSubmit
        formId={formId}
        label={`Import ${batchCount} customer${batchCount === 1 ? '' : 's'}`}
        confirmLabel={`Import ${batchCount} customer${batchCount === 1 ? '' : 's'}?`}
        description="Rows marked Review, Duplicate or Invalid are skipped and stay exactly as they are — nothing about them is written."
        tone="primary"
        size="default"
        pending={pending}
      />
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}
