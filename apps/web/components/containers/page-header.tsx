import type { ReactNode } from 'react';
import { cx } from '../class-names';
import { PageCrumbs, type Crumb } from './workspace-crumbs';
import { ConfigureTrigger } from './workspace-right-rail';

export type PageHeaderCrumb = Crumb;

/**
 * The one page/record identity: which page am I on, and what can I do to it. It sits inside the
 * page's own `AppPage`, so it shares the canvas its content sits on and is never full-bleed;
 * `WorkspaceHeader` above it is the global bar and holds none of this.
 *
 * A Server Component on purpose — a page passes whatever interactive actions it wants
 * (`CreateResourceTrigger`, `ConfigureTrigger`) as children of `actions`, and only those are
 * client code. Presentation only: no route, no capability, no domain knowledge. A page decides
 * which actions to offer; hiding one is courtesy, never the security boundary.
 *
 * **Configure is always the last action.** It opens the right-hand rail, so it sits nearest that
 * edge, after every business action. A page asks for it with `configure` and never places it, which
 * is what makes the order impossible to get wrong; `ConfigureTrigger` is rendered nowhere else.
 *
 * `crumbs` are ancestors only; `title` is the current page and the page's single `<h1>`.
 */
export function PageHeader({
  title,
  crumbs,
  description,
  meta,
  actions,
  configure = false,
  className,
}: {
  title: ReactNode;
  crumbs?: PageHeaderCrumb[];
  description?: ReactNode;
  /** Short, secondary facts about the record — a schedule window, a status — under the title. */
  meta?: ReactNode;
  /** Business actions, in reading order. Never Configure — see `configure`. */
  actions?: ReactNode;
  /** Offers Configure, rendered after `actions`. Courtesy only; the panel's own writes are guarded by RLS. */
  configure?: boolean;
  /** Replaces the default bottom margin (`mb-6`) where the parent already spaces its children. */
  className?: string;
}) {
  return (
    <header className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className ?? 'mb-6')}>
      <div className="min-w-0 flex-1 basis-64">
        {crumbs && crumbs.length > 0 ? <PageCrumbs crumbs={crumbs} /> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
      </div>
      {actions || configure ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {configure ? <ConfigureTrigger /> : null}
        </div>
      ) : null}
    </header>
  );
}
