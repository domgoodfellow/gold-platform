import type { ReactNode } from 'react';
import { cx } from '../class-names';
import { PageLocation, type PageLocationCrumb } from '../navigation/page-location';
import { SupportTrigger } from '../panels/workspace-right-rail';
import { HeaderControls } from '../headers/header-controls';
import { BusinessLabel } from '@/lib/context/business-vocabulary';
import { LocationHeading, PageLocationRecords } from '../navigation/workspace-crumbs';
import type { RecordLabel } from '@/lib/route/page-location';

/**
 * Collection/Board: compact identity and controls, then the collection or board itself promptly —
 * never a large introductory block above the work surface the operator came to use
 * (`docs/ui-system.md`). Tighter default spacing than `PageHeader`'s `mb-6`, and no description
 * slot at all: the table or board explains itself.
 */
export function CollectionHeader({
  title,
  crumbs,
  breadcrumbLabel,
  location,
  navigation = false,
  actions,
  activity = false,
  insights = false,
  configure = false,
  className,
}: {
  /** Required unless `location` is given. */
  title?: ReactNode;
  crumbs?: PageLocationCrumb[];
  /**
   * The route's location comes from `resolveLocation` (ADR-047): the bar shows it and this header
   * renders only the resolver-named `h1` and hands up any record labels. Replaces `title`, `crumbs`
   * and `breadcrumbLabel`.
   */
  location?: { records?: Readonly<Record<string, RecordLabel>> };
  breadcrumbLabel?: ReactNode;
  /** The current workspace's destinations in the action row, as on `PageHeader`. */
  navigation?: boolean;
  /** Board/collection controls, in reading order — a stage-settings control, a create trigger. */
  actions?: ReactNode;
  activity?: boolean;
  insights?: boolean;
  configure?: boolean;
  className?: string;
}) {
  const titleInBar = location !== undefined || (breadcrumbLabel === undefined && typeof title === 'string');
  return (
    <header className={cx('@container/page-header flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className ?? 'mb-4')}>
      <div className={cx("min-w-0 flex-1 basis-64", titleInBar && 'sr-only')}>
        {location ? (
          <>
            {location.records ? <PageLocationRecords records={location.records} /> : null}
            <LocationHeading required />
          </>
        ) : (
          <>
            <PageLocation crumbs={crumbs} current={breadcrumbLabel ?? <BusinessLabel>{title}</BusinessLabel>} />
            <h1 className="text-xl font-semibold tracking-tight"><BusinessLabel>{title}</BusinessLabel></h1>
          </>
        )}
      </div>
      {navigation || actions || activity || insights || configure ? (
        <HeaderControls navigation={navigation}>
          {actions}
          {activity ? <SupportTrigger mode="activity" /> : null}
          {insights ? <SupportTrigger mode="insights" /> : null}
          {configure ? <SupportTrigger mode="configure" /> : null}
        </HeaderControls>
      ) : null}
    </header>
  );
}
