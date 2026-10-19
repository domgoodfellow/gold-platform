'use client';

import { usePathname } from 'next/navigation';
import { headerDestinations } from '@/lib/shell';
import { useLocationNavigation } from './workspace-crumbs';
import { ViewNav } from './view-nav';

/**
 * The current workspace's destinations as a compact strip in the page header row. A presentation of
 * the authorized projection the sidebar draws — it defines no route, label, order or visibility of
 * its own, so business vocabulary and permission changes reach both at once. Renders nothing where
 * the projection offers no workspace strip; the contextual sidebar remains the navigation everywhere.
 */
export function WorkspaceDestinationNav() {
  const navigation = useLocationNavigation();
  const pathname = usePathname();
  const destinations = headerDestinations(navigation, pathname);
  if (!destinations) return null;
  return (
    <ViewNav
      label={`${destinations.label} destinations`}
      className="mb-0"
      current={destinations.activeKey}
      items={destinations.items.map((item) => ({ key: item.key, label: item.label, href: item.href }))}
    />
  );
}
