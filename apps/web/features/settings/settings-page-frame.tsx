import type { ComponentProps, ReactNode } from 'react';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';

/**
 * Shared Settings frame. Settings is one shell page, not a shell inside the shell. Forms read at a
 * bounded width; a page with tables or catalogues asks for `fluid`.
 */
export function SettingsPageFrame({
  width = 'form',
  children,
}: {
  width?: 'form' | 'fluid';
  children: ReactNode;
}) {
  return <AppPage width={width}>{children}</AppPage>;
}

/**
 * The page identity for a Settings destination (ADR-047, A6). The global bar shows the resolved
 * location — `Settings › {Page}`, Settings as plain text because it has no index page — so the page
 * keeps a visually hidden `h1` and prints its title nowhere else. `title` stays the accessible
 * statement of the page for callers that pass richer text; the resolver names the heading.
 *
 * `legacyTrail` keeps a page whose location is still under review (Custom fields, Secrets: ADR-047
 * B-D5) on the earlier presentation: "Settings" in the bar and the title printed beneath.
 */
export function SettingsPageHeader({ legacyTrail = false, records, title, ...props }: Omit<ComponentProps<typeof PageHeader>, 'crumbs' | 'breadcrumbLabel' | 'section' | 'location'> & {
  legacyTrail?: boolean;
  /** Labels for the route's dynamic segments, such as a role's name. */
  records?: NonNullable<ComponentProps<typeof PageHeader>['location']>['records'];
}) {
  if (legacyTrail) return <PageHeader {...props} title={title} section="Settings" />;
  return <PageHeader {...props} title={title} location={{ records }} />;
}
