import type { ReactNode } from 'react';
import { AppPage } from '../layout/app-page';
import type { PageLocationCrumb } from '../navigation/page-location';
import { PageHeader } from '../headers/page-header';

/**
 * Workspace Home: what is happening here, what can I do, where can I go next (`docs/ui-system.md`
 * §2a's Workspace Home archetype). No generic "<Workspace>: <restated purpose sentence>" line —
 * the title is the workspace's name, and everything beneath it is real content: destination
 * summaries, state, recent or attention-worthy items. `children` is the workspace's own content;
 * an empty workspace still renders its structure, with a real empty state inside that structure
 * rather than collapsing the whole page into one sentence.
 *
 * The page frame plus `PageHeader` with the workspace-home page type: the header is the same one
 * every page uses, not a second implementation.
 */
export function WorkspaceHome({
  title,
  crumbs,
  location,
  meta,
  actions,
  insights = false,
  activity = false,
  configure = false,
  dashboard = false,
  children,
}: {
  /** Required unless `location` is given. */
  title?: ReactNode;
  crumbs?: PageLocationCrumb[];
  /** The route's location and heading come from `resolveLocation` (ADR-047); replaces `title` and `crumbs`. */
  location?: Record<string, never>;
  /** Facts about what the dashboard is showing, in the header's leading region. Never a purpose sentence. */
  meta?: ReactNode;
  actions?: ReactNode;
  insights?: boolean;
  /** Offers the page-support Activity panel; the page registers its feed there instead of drawing it inline. */
  activity?: boolean;
  configure?: boolean;
  dashboard?: boolean;
  children: ReactNode;
}) {
  return (
    <AppPage data-dashboard-page={dashboard || undefined}>
      {/* A workspace name is not passed through the business vocabulary, as before: `recordTitle`. */}
      <PageHeader archetype="workspace-home" recordTitle title={title} crumbs={crumbs} location={location ? {} : undefined} meta={meta} actions={actions} activity={activity} insights={insights} configure={configure} />
      {children}
    </AppPage>
  );
}
