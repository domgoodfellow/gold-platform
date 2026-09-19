import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@gold/ui/components/breadcrumb';
import { cx, FOCUS_RING } from '../class-names';

export type PageHeaderCrumb = { label: ReactNode; href?: string };

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
 * `crumbs` are ancestors only; `title` is the current page and the page's single `<h1>`.
 */
export function PageHeader({
  title,
  crumbs,
  description,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  crumbs?: PageHeaderCrumb[];
  description?: ReactNode;
  /** Short, secondary facts about the record — a schedule window, a status — under the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Replaces the default bottom margin (`mb-6`) where the parent already spaces its children. */
  className?: string;
}) {
  return (
    <header className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className ?? 'mb-6')}>
      <div className="min-w-0 flex-1 basis-64">
        {crumbs && crumbs.length > 0 ? (
          <Breadcrumb className="mb-1">
            <BreadcrumbList className="gap-1 text-sm">
              {crumbs.map((crumb, index) => (
                <Fragment key={index}>
                  {index > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem className="min-w-0">
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className={cx('truncate rounded underline-offset-4 hover:text-foreground hover:underline', FOCUS_RING)}
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      // An ancestor label with no route of its own — a group name, not a page.
                      <span className="truncate">{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
