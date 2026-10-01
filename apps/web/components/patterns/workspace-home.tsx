import type { ReactNode } from 'react';
import { AppPage } from '../layout/app-page';
import { PageLocation, type PageLocationCrumb } from '../navigation/page-location';
import { SupportTrigger } from '../panels/workspace-right-rail';

/**
 * Workspace Home: what is happening here, what can I do, where can I go next (`docs/ui-spec.md`
 * §2a's Workspace Home archetype). No generic "<Workspace>: <restated purpose sentence>" line —
 * the title is the workspace's name, and everything beneath it is real content: destination
 * summaries, state, recent or attention-worthy items. `children` is the workspace's own content;
 * an empty workspace still renders its structure, with a real empty state inside that structure
 * rather than collapsing the whole page into one sentence.
 */
export function WorkspaceHome({
  title,
  crumbs,
  actions,
  insights = false,
  configure = false,
  children,
}: {
  title: ReactNode;
  crumbs?: PageLocationCrumb[];
  actions?: ReactNode;
  insights?: boolean;
  configure?: boolean;
  children: ReactNode;
}) {
  return (
    <AppPage>
      <PageLocation crumbs={crumbs} current={title} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {actions || insights || configure ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {insights ? <SupportTrigger mode="insights" /> : null}
            {configure ? <SupportTrigger mode="configure" /> : null}
          </div>
        ) : null}
      </div>
      {children}
    </AppPage>
  );
}
