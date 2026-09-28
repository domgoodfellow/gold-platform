import type { ReactNode } from 'react';
import { cx } from '../class-names';
import { PageCrumbs, type Crumb } from './workspace-crumbs';
import { SupportTrigger } from './workspace-right-rail';

export type PageHeaderCrumb = Crumb;

/**
 * The one page/record identity: which page am I on, and what can I do to it. It sits inside the
 * page's own `AppPage`, so it shares the canvas its content sits on and is never full-bleed;
 * `WorkspaceHeader` above it is the global bar and holds none of this.
 *
 * A Server Component on purpose — a page passes whatever interactive actions it wants
 * (`CreateResourceTrigger`) as children of `actions`, and only those are client code.
 * Presentation only: no route, no capability, no domain knowledge. A page decides which actions
 * to offer; hiding one is courtesy, never the security boundary.
 *
 * **The page-support modes are always last, in one order: Activity, Insights, Configure.** They open
 * the right-hand rail, so they sit nearest that edge, after every business action. A page asks for
 * a mode with `activity`, `insights` or `configure` — only a mode it genuinely supports — and never
 * places one, which is what makes the order impossible to get wrong; `SupportTrigger` is rendered
 * nowhere else. Each is paired with a `SupportRegistrar` on the page that holds its content.
 *
 * `crumbs` are ancestors only; `title` is the current page and the page's single `<h1>`. This
 * always publishes a trail into the workspace bar — `ancestors + current page` — even when
 * `crumbs` is empty, so no page leaves the sticky header's location area blank. The published
 * current-page label is `breadcrumbLabel` when given, else `title` itself; the override exists
 * only for a title that is visually richer (an icon, a status pill) than the plain text a
 * breadcrumb should show.
 */
export function PageHeader({
  title,
  crumbs,
  breadcrumbLabel,
  description,
  meta,
  actions,
  activity = false,
  insights = false,
  configure = false,
  className,
}: {
  title: ReactNode;
  crumbs?: PageHeaderCrumb[];
  /** Overrides the current-page breadcrumb label; defaults to `title`. */
  breadcrumbLabel?: ReactNode;
  description?: ReactNode;
  /** Short, secondary facts about the record — a schedule window, a status — under the title. */
  meta?: ReactNode;
  /** Business actions, in reading order. Never Configure — see `configure`. */
  actions?: ReactNode;
  /** Offers the Activity mode: what recently changed here. Only where a domain-level read exists. */
  activity?: boolean;
  /** Offers the Insights mode: a few numbers for this workspace, from the reporting aggregates. */
  insights?: boolean;
  /** Offers Configure. Courtesy only; the panel's own writes are guarded by RLS. */
  configure?: boolean;
  /** Replaces the default bottom margin (`mb-6`) where the parent already spaces its children. */
  className?: string;
}) {
  return (
    <header className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className ?? 'mb-6')}>
      <div className="min-w-0 flex-1 basis-64">
        <PageCrumbs crumbs={crumbs ?? []} current={breadcrumbLabel ?? title} />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
      </div>
      {actions || activity || insights || configure ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {activity ? <SupportTrigger mode="activity" /> : null}
          {insights ? <SupportTrigger mode="insights" /> : null}
          {configure ? <SupportTrigger mode="configure" /> : null}
        </div>
      ) : null}
    </header>
  );
}
