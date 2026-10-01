import type { ReactNode } from 'react';
import { cx } from '../class-names';
import { PageLocation, type PageLocationCrumb } from '../navigation/page-location';
import { SupportTrigger } from '../panels/workspace-right-rail';

/**
 * Collection/Board: compact identity and controls, then the collection or board itself promptly —
 * never a large introductory block above the work surface the operator came to use
 * (`docs/ui-spec.md` §2a). Tighter default spacing than `PageHeader`'s `mb-6`, and no description
 * slot at all: the table or board explains itself.
 */
export function CollectionHeader({
  title,
  crumbs,
  breadcrumbLabel,
  actions,
  activity = false,
  insights = false,
  configure = false,
  className,
}: {
  title: ReactNode;
  crumbs?: PageLocationCrumb[];
  breadcrumbLabel?: ReactNode;
  /** Board/collection controls, in reading order — a stage-settings control, a create trigger. */
  actions?: ReactNode;
  activity?: boolean;
  insights?: boolean;
  configure?: boolean;
  className?: string;
}) {
  return (
    <header className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className ?? 'mb-4')}>
      <div className="min-w-0 flex-1 basis-64">
        <PageLocation crumbs={crumbs} current={breadcrumbLabel ?? title} />
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
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
