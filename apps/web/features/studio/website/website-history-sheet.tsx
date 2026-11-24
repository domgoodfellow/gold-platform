'use client';

import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { StatePill } from '@/components/operational/primitives';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import type { RevisionHistoryEntry } from '@/lib/domain/public-site/public-site';
import { createDraftAction, type WebsiteActionState } from '@/app/organizations/[organizationId]/studio/website/actions';

/** In the business's own time zone, so the server and the browser write the same words. */
const formatWhen = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

const INITIAL: WebsiteActionState = { error: null };

const STATUS: Record<RevisionHistoryEntry['status'], string> = {
  draft: 'Draft', in_review: 'In review', published: 'Published', archived: 'Archived', discarded: 'Discarded',
};


/**
 * Revision history: every content revision of the whole website, newest first, with the published
 * one and the working one named. Restoring copies a revision forward into a new draft — history is
 * never rewritten — so it needs no draft to be open; with one open, the blocker says what to do.
 * Opening history, or a revision's preview from it, changes nothing.
 *
 * `open`/`onOpenChange` let the workbench open it from a link (`?panel=history`).
 */
export function WebsiteHistorySheet({ organizationId, timezone, history, workingId, publishedId, open, onOpenChange }: {
  organizationId: string;
  timezone: string;
  history: RevisionHistoryEntry[];
  workingId: string | null;
  publishedId: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [state, action, pending] = useActionState(createDraftAction, INITIAL);
  useEffect(() => { if (state.success) toast.success(state.success); }, [state]);
  const canRestore = workingId === null;
  return (
    <PageDrawer open={open} onOpenChange={onOpenChange}>
      <PageDrawerTrigger asChild>
        <Button tone="text" size="small">History</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Revision history</PageDrawerTitle>
        </PageDrawerHeader>
        <ErrorText>{state.error}</ErrorText>
        {!canRestore ? <Hint>Discard or publish the working draft to restore an earlier revision.</Hint> : null}
        {history.length === 0 ? (
          <EmptyState>No revisions yet.</EmptyState>
        ) : (
          <DividedList className="text-sm" aria-label="Revisions">
            {history.map((revision) => {
              const role = revision.id === publishedId ? { label: 'Live', tone: 'success' as const } : revision.id === workingId ? { label: 'Working', tone: 'neutral' as const } : null;
              return (
                <li key={revision.id} className="grid gap-1 py-3" aria-current={revision.id === workingId ? 'true' : undefined}>
                  <div className="flex justify-between gap-3">
                    <span className="flex items-center gap-2 font-medium">Revision {revision.number}{role ? <StatePill tone={role.tone}>{role.label}</StatePill> : null}</span>
                    <span className="text-muted">{STATUS[revision.status]}</span>
                  </div>
                  <span className="text-xs text-subtle">
                    {revision.createdSource === 'migration' ? 'Written by a GildOps release' : 'Created in Studio'} {formatWhen(revision.createdAt, timezone)}
                    {revision.copiedFromRevisionNumber !== null ? ` · from revision ${revision.copiedFromRevisionNumber}` : ''}
                  </span>
                  {revision.publishedAt ? <span className="text-xs text-subtle">Published {formatWhen(revision.publishedAt, timezone)}</span> : null}
                  {revision.archivedAt ? <span className="text-xs text-subtle">Replaced {formatWhen(revision.archivedAt, timezone)}</span> : null}
                  {revision.discardedAt ? <span className="text-xs text-subtle">Discarded {formatWhen(revision.discardedAt, timezone)}</span> : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <ButtonLink tone="secondary" size="small" href={`/preview/${organizationId}/${revision.id}`} target="_blank" aria-label={`View revision ${revision.number}`}>View</ButtonLink>
                    {revision.id !== workingId && revision.id !== publishedId ? (
                      <form action={action}>
                        <input type="hidden" name="organizationId" value={organizationId} />
                        <input type="hidden" name="fromRevisionId" value={revision.id} />
                        <Button tone="secondary" size="small" disabled={pending || !canRestore} aria-label={`Restore revision ${revision.number} as a draft`}>Restore as draft</Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </DividedList>
        )}
      </PageDrawerContent>
    </PageDrawer>
  );
}
