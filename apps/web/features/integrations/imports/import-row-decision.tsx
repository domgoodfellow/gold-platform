'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SelectField } from '@/components/controls/select-field';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText } from '@/components/controls/inputs';
import type { ImportRowDecision } from '@/lib/domain/integrations/import-runs';
import {
  decideImportRowAction,
  skipUndecidedImportRowsAction,
  type ApplyState,
} from '@/app/organizations/[organizationId]/library/imports/[runId]/actions';

export type DecisionChoice = { value: string; label: string };

/**
 * One staged row's decision: Create new contact, Update one of the contacts it might be, or Skip.
 * Saved as soon as it is chosen; the row's status follows on the refreshed page.
 */
export function ImportRowDecisionField({ organizationId, runId, rowId, rowName, value, choices }: {
  organizationId: string;
  runId: string;
  rowId: string;
  rowName: string;
  /** `create`, `skip`, `update:<contact id>`, or empty while the row still needs review. */
  value: string;
  choices: DecisionChoice[];
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (next: string) => {
    const previous = current;
    setCurrent(next);
    setError(null);
    const [decision, customerId] = next.split(':') as [ImportRowDecision, string | undefined];
    startTransition(async () => {
      const result = await decideImportRowAction(organizationId, runId, rowId, decision, customerId ?? null);
      if (result.error) { setCurrent(previous); setError(result.error); return; }
      router.refresh();
    });
  };
  return <div className="min-w-48">
    <SelectField aria-label={`Decision for ${rowName}`} size="small" value={current} placeholder="Choose…" disabled={pending}
      onValueChange={decide} options={choices} />
    <ErrorText>{error}</ErrorText>
  </div>;
}

const SKIP_INITIAL: ApplyState = { error: null };

/** Skips every row still marked Needs review, after a confirmation. */
export function SkipUndecidedRows({ organizationId, runId, count }: { organizationId: string; runId: string; count: number }) {
  const [state, formAction, pending] = useActionState(skipUndecidedImportRowsAction, SKIP_INITIAL);
  const formId = `skip-undecided-${runId}`;
  const rows = `${count} row${count === 1 ? '' : 's'}`;
  return <form id={formId} action={formAction}>
    <input type="hidden" name="organizationId" value={organizationId} />
    <input type="hidden" name="runId" value={runId} />
    <ConfirmSubmit formId={formId} label={`Skip ${rows} needing review`} confirmLabel={`Skip ${rows}?`} tone="secondary" size="default" pending={pending}
      description="Nothing is written for skipped rows, and the contacts they match are left as they are." />
    <ErrorText>{state.error}</ErrorText>
  </form>;
}
