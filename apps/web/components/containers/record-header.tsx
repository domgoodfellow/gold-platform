'use client';

import { useMemo, type ReactNode } from 'react';
import { useWorkspacePageChrome } from './workspace-page-chrome';

export type RecordCrumb = { label: ReactNode; href?: string };

/**
 * A detail screen's identity and route context — registered with the shell header rather than
 * rendered in the body, so the header stays the one place a route's location is shown (see
 * `workspace-page-chrome.tsx`). Kept under its historical name and prop shape so every existing
 * call site needed no prop changes to stop rendering a second heading; `summary` maps onto the
 * header's status slot. Product metadata remains feature-owned.
 *
 * `crumbs` here is the historical shape: ancestors *and* the current page as its last, href-less
 * entry (`title` duplicates that same label for the old page heading). `PageChrome`'s own
 * `crumbs` are ancestors only — `title` is the current page — so the last entry is dropped before
 * registering, or every caller here would show its own name twice.
 */
export function RecordHeader({
  title,
  crumbs,
  summary,
  actions,
}: {
  title: ReactNode;
  crumbs: RecordCrumb[];
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  const chrome = useMemo(
    () => ({ title, crumbs: crumbs.slice(0, -1), status: summary, actions }),
    [title, crumbs, summary, actions],
  );
  useWorkspacePageChrome(chrome);
  return null;
}
