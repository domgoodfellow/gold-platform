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
 * The page identity for a Settings destination. The global bar already says where the person is —
 * "Settings", with the sidebar marking the section — so the title beneath it is the one visible
 * statement of what this page is, and the bar does not repeat it.
 */
export function SettingsPageHeader(props: Omit<ComponentProps<typeof PageHeader>, 'crumbs' | 'breadcrumbLabel' | 'section'>) {
  return <PageHeader {...props} section="Settings" />;
}
