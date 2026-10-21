import type { ReactNode } from 'react';
import { AppPage } from '../layout/app-page';
import { PageLocation, type PageLocationCrumb } from '../navigation/page-location';
import { SupportTrigger } from '../panels/workspace-right-rail';
import { LocationHeading } from '../navigation/workspace-crumbs';

/**
 * Workspace Home: what is happening here, what can I do, where can I go next (`docs/ui-system.md`
 * §2a's Workspace Home archetype). No generic "<Workspace>: <restated purpose sentence>" line —
 * the title is the workspace's name, and everything beneath it is real content: destination
 * summaries, state, recent or attention-worthy items. `children` is the workspace's own content;
 * an empty workspace still renders its structure, with a real empty state inside that structure
 * rather than collapsing the whole page into one sentence.
 */
export function WorkspaceHome({
  title,
  crumbs,
  location,
  actions,
  insights = false,
  activity = false,
  configure = false,
  children,
}: {
  /** Required unless `location` is given. */
  title?: ReactNode;
  crumbs?: PageLocationCrumb[];
  /** The route's location and heading come from `resolveLocation` (ADR-047); replaces `title` and `crumbs`. */
  location?: Record<string, never>;
  actions?: ReactNode;
  insights?: boolean;
  /** Offers the page-support Activity panel; the page registers its feed there instead of drawing it inline. */
  activity?: boolean;
  configure?: boolean;
  children: ReactNode;
}) {
  // The workspace bar already names the page on every width, so a plain-text title stays for assistive
  // technology only rather than being printed a second time.
  const titleInBar = typeof title === 'string';
  return (
    <AppPage>
      {location ? null : <PageLocation crumbs={crumbs} current={title} />}
      <div className="mb-6 flex flex-wrap items-center justify-end gap-x-4 gap-y-3">
        {location ? <LocationHeading required /> : <h1 className={titleInBar ? 'sr-only' : 'mr-auto text-2xl font-semibold tracking-tight'}>{title}</h1>}
        {actions || insights || activity || configure ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {activity ? <SupportTrigger mode="activity" /> : null}
            {insights ? <SupportTrigger mode="insights" /> : null}
            {configure ? <SupportTrigger mode="configure" /> : null}
          </div>
        ) : null}
      </div>
      {children}
    </AppPage>
  );
}
