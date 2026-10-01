import type { ReactNode } from 'react';
import { PageCrumbs, type Crumb } from './workspace-crumbs';

export type { Crumb as PageLocationCrumb };

/**
 * Publishes this page's location — `ancestors + current` — into `WorkspaceHeader`'s breadcrumb
 * slot. Nothing else: no title, no visible chrome, no actions. A screen pattern that renders its
 * own `<h1>` composes this alongside it; `PageHeader` composes it internally for callers that want
 * both in one call. Every navigable page renders exactly one of these (directly, or through a
 * pattern that does), so the workspace bar never shows a blank location.
 */
export function PageLocation({ crumbs, current }: { crumbs?: Crumb[]; current: ReactNode }) {
  return <PageCrumbs crumbs={crumbs ?? []} current={current} />;
}
