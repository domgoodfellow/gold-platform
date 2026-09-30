'use client';

import { Button } from '@/components/controls/button';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';

export type HistoryEntry = { id: string; number: number; status: string; publishedAt: string | null; archivedAt: string | null };

/**
 * Revision history, contextual from the toolbar rather than a permanent section under the editor.
 * Read-only in this slice — no restoration, no rollback; those do not exist in the domain layer
 * yet, and this panel does not invent them. A page drawer, not a modal `Sheet` — the workbench
 * stays usable beside it.
 */
export function RevisionHistorySheet({ history }: { history: HistoryEntry[] }) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild>
        <Button tone="text" size="small">History</Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Revision history</PageDrawerTitle>
        </PageDrawerHeader>
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
              </li>
            ))}
          </DividedList>
        )}
      </PageDrawerContent>
    </PageDrawer>
  );
}
