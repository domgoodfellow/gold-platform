'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { FormRenderer } from '@/features/forms/form-renderer';
import { inspectFormRevisionAction } from '@/app/organizations/[organizationId]/studio/forms/actions';
import type { FormHistoryEntry, FormRevision } from '@/lib/domain/forms/forms';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';

/**
 * Form history and exact saved definitions. Inspection never replaces the working draft or
 * changes the revision that public visitors receive.
 */
export function RevisionHistorySheet({ organizationId, formId, history }: { organizationId: string; formId: string; history: FormHistoryEntry[] }) {
  const [selected, setSelected] = useState<FormRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild>
        <Button tone="text" size="small">History</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Revision history</PageDrawerTitle>
        </PageDrawerHeader>
        {selected ? <section aria-label={`Saved revision ${selected.number}`} className="grid gap-3">
          <Button tone="secondary" size="small" onClick={() => setSelected(null)}>Back to revisions</Button>
          <Hint>Revision {selected.number} · {selected.status}. Read-only saved content.</Hint>
          <fieldset disabled className="rounded-lg border border-border bg-surface p-4">
            <FormRenderer definition={selected.definition} values={{}} onChange={() => undefined} />
          </fieldset>
        </section> : <>
        {history.length === 0 ? (
          <EmptyState>No revisions yet.</EmptyState>
        ) : (
          <DividedList className="text-sm">
            {history.map((revision) => (
              <li key={revision.id} className="grid gap-0.5 py-3">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">Revision {revision.number}</span>
                  <span className="text-muted">{revision.status.replace('_', ' ')}</span>
                </div>
                {revision.publishedAt ? <span className="text-xs text-subtle">Published {new Date(revision.publishedAt).toLocaleString()}</span> : null}
                {revision.archivedAt ? <span className="text-xs text-subtle">Archived {new Date(revision.archivedAt).toLocaleString()}</span> : null}
                <span className="text-xs text-subtle">{revision.submissionCount} responses</span>
                <div><Button tone="secondary" size="small" disabled={pending} aria-label={`Inspect revision ${revision.number}`} onClick={() => startTransition(async () => {
                  setError(null);
                  const result = await inspectFormRevisionAction({ organizationId, formId, revisionId: revision.id });
                  if (result.error) setError(result.error);
                  else setSelected(result.revision);
                })}>Inspect</Button></div>
              </li>
            ))}
          </DividedList>
        )}
        </>}
        <ErrorText role="alert">{error}</ErrorText>
      </PageDrawerContent>
    </PageDrawer>
  );
}
