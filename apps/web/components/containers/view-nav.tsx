import Link from 'next/link';
import type { ReactNode } from 'react';
import { tabsListClassName, tabsTriggerClassName } from '@gold/ui/components/tab-styles';
import { cx } from '../class-names';

export type ViewNavItem = { key: string; label: ReactNode; href: string };

/**
 * Sibling views of one workspace — Customers' List and Pipeline, Team's Members, Invitations and
 * Roles. Navigation, not an action: each view is a URL, so it survives a reload, arrives with the
 * back button and can be sent to somebody, and the server renders it without a client controller.
 *
 * It sits between `PageHeader` and the toolbar and holds nothing else. What a page *does* to the
 * workspace (create, import, configure) is `PageHeader.actions`, and is never disguised as a view
 * or stood beside one. It shares its look with the Radix `Tabs` through `tab-styles`.
 */
export function ViewNav({
  label,
  views,
  current,
  className,
}: {
  label: string;
  views: ViewNavItem[];
  current: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cx(tabsListClassName, 'mb-4', className)}>
      {views.map((view) => (
        <Link
          key={view.key}
          href={view.href}
          aria-current={view.key === current ? 'page' : undefined}
          className={tabsTriggerClassName}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
