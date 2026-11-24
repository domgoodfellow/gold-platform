import type { ReactNode } from 'react';
import type { PageLocationCrumb } from '../navigation/page-location';
import { PageHeader } from '../headers/page-header';
import type { RecordLabel } from '@/lib/route/page-location';

/**
 * Collection/Board: compact identity and controls, then the collection or board itself promptly —
 * never a large introductory block above the work surface the operator came to use
 * (`docs/ui-system.md`). It is `PageHeader` with the collection page type — a smaller visible title
 * and tighter spacing — and no description slot at all: the table or board explains itself.
 */
export function CollectionHeader({
  title,
  crumbs,
  breadcrumbLabel,
  location,
  meta,
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
  /** Facts about what the collection is showing, in the header's leading region. Never a purpose sentence. */
  meta?: ReactNode;
  /** Board/collection controls, in reading order — a stage-settings control, a create trigger. */
  actions?: ReactNode;
  activity?: boolean;
  insights?: boolean;
  configure?: boolean;
  className?: string;
}) {
  return <PageHeader archetype="collection" title={title} crumbs={crumbs} breadcrumbLabel={breadcrumbLabel} location={location} meta={meta} actions={actions} activity={activity} insights={insights} configure={configure} className={className} />;
}
