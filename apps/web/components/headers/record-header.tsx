import type { ReactNode } from 'react';
import { PageHeader } from './page-header';
import type { RecordLabel } from '@/lib/route/page-location';

export type RecordCrumb = { label: ReactNode; href?: string };

type Identity =
  | { title: ReactNode; crumbs: RecordCrumb[]; location?: undefined }
  /** A route migrated to `resolveLocation` (ADR-047): the resolver owns the trail and heading; the page supplies its record label. */
  | { location: { records: Readonly<Record<string, RecordLabel>> }; title?: undefined; crumbs?: undefined };

/**
 * A detail screen's identity, kept under its historical name and prop shape so every detail
 * route needed no prop changes: `crumbs` still ends with the current page, `summary` becomes
 * `PageHeader`'s metadata line. Renders `PageHeader` — there is one page-header, not two.
 *
 * `crumbs` here is the historical shape: ancestors *and* the current page as its last, href-less
 * entry (`title` duplicates that same label). `PageHeader`'s own `crumbs` are ancestors only, so
 * the last entry is dropped or every caller would show its own name twice.
 */
export function RecordHeader({ summary, actions, ...identity }: Identity & { summary?: ReactNode; actions?: ReactNode }) {
  if (identity.location) return <PageHeader location={identity.location} meta={summary} actions={actions} />;
  const { title, crumbs } = identity;
  return <PageHeader recordTitle title={title} crumbs={crumbs.slice(0, -1)} meta={summary} actions={actions} />;
}
