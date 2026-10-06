'use client';

import { useActionState } from 'react';
import { Button, ButtonLink } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import type { RevisionHistoryEntry } from '@/lib/domain/public-site/public-site';
import { createDraftAction, type WebsiteActionState } from '@/app/organizations/[organizationId]/studio/website/actions';



const INITIAL: WebsiteActionState = { error: null };

/**
 * Revision history, contextual from the toolbar rather than a permanent section under the editor.
 * Every revision is the whole website at one moment. Restoring one never rewrites history: it
 * copies that revision forward into a new draft, which goes through review and publishing like any
 * other — so an earlier website comes back whole, with its pages and navigation together. Only
 * possible while there is no working draft.
 */
export function WebsiteHistorySheet({ organizationId, history, canRestore }: { organizationId: string; history: RevisionHistoryEntry[]; canRestore: boolean }) {
  const [state, action, pending] = useActionState(createDraftAction, INITIAL);
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild>
        <Button tone="text" size="small">History</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Revision history</PageDrawerTitle>
        </PageDrawerHeader>
        <ErrorText>{state.error}</ErrorText>
        {history.length === 0 ? (
          <EmptyState>No revisions yet.</EmptyState>
        ) : (
          <DividedList className="text-sm">
            {history.map((revision) => (
              <li key={revision.id} className="grid gap-1 py-3">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">Revision {revision.number}</span>
                  <span className="text-muted">{revision.status.replace('_', ' ')}</span>
                </div>
                <span className="text-xs text-subtle">Created {new Date(revision.createdAt).toLocaleString()}</span>
                {revision.publishedAt ? <span className="text-xs text-subtle">Published {new Date(revision.publishedAt).toLocaleString()}</span> : null}
                {revision.archivedAt ? <span className="text-xs text-subtle">Archived {new Date(revision.archivedAt).toLocaleString()}</span> : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <ButtonLink tone="secondary" size="small" href={`/preview/${organizationId}/${revision.id}`} target="_blank">View</ButtonLink>
                  {revision.status === 'archived' && canRestore ? (
                    <form action={action}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="fromRevisionId" value={revision.id} />
                      <Button tone="secondary" size="small" disabled={pending} aria-label={`Restore revision ${revision.number} as a draft`}>Restore as draft</Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </DividedList>
        )}
      </PageDrawerContent>
    </PageDrawer>
  );
}
