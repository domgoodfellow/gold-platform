'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { ViewModeSwitcher, type CollectionPresentation } from '../controls/view-mode-switcher';

/**
 * One collection, several representations, the reader's choice remembered.
 *
 * The page declares which presentations it supports by passing one rendering for each — it is never
 * asked to support all three. The renderings arrive as already-built nodes, so a server component
 * can hand them over; this component only chooses which one is drawn and holds the switcher.
 *
 * The choice is a personal, per-browser preference kept in `localStorage` under `storageKey` — no
 * database column, and nothing here decides what somebody may see. A value that is missing,
 * unreadable or no longer supported falls back to `defaultPresentation`, and the server render
 * always draws that default, so hydration never disagrees with it.
 *
 * `DataTable`'s own table-to-cards fallback at narrow widths is a separate, automatic behaviour and
 * is untouched: a table presentation here is still a `DataTable`.
 */
export type CollectionRenderings = Partial<Record<CollectionPresentation, ReactNode>>;

const listeners = new Set<() => void>();
/** What was chosen this session when storage refuses the write, so the switcher still works. */
const session = new Map<string, string>();

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? session.get(key) ?? null;
  } catch {
    return session.get(key) ?? null;
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener('storage', notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
}

export function CollectionView({
  storageKey,
  renderings,
  defaultPresentation,
  label,
}: {
  /** Names the preference, e.g. `gold.settings.presentation`. One per surface. */
  storageKey: string;
  renderings: CollectionRenderings;
  defaultPresentation: CollectionPresentation;
  /** Accessible name of the switcher. */
  label?: string;
}) {
  const supported = (Object.keys(renderings) as CollectionPresentation[]).filter((key) => renderings[key] != null);

  const stored = useSyncExternalStore(
    subscribe,
    () => readStored(storageKey),
    () => null,
  );
  const current = supported.find((presentation) => presentation === stored) ?? defaultPresentation;

  const choose = useCallback(
    (next: CollectionPresentation) => {
      session.set(storageKey, next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Storage can be blocked; the choice then lasts for this session only.
      }
      for (const notify of listeners) notify();
    },
    [storageKey],
  );

  return (
    <div className="flex flex-col gap-4">
      {supported.length > 1 ? (
        <div className="flex justify-end">
          <ViewModeSwitcher supported={supported} value={current} onChange={choose} label={label} />
        </div>
      ) : null}
      {renderings[current]}
    </div>
  );
}
