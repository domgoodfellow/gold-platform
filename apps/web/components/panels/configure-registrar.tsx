'use client';

import type { ReactNode } from 'react';
import { SupportRegistrar } from './support-registrar';

/**
 * A page's Configure panel — the `configure` mode of the page-support rail. Shared by every
 * workspace with contextual configuration (Work, Schedule, Customers, Resources, Locations,
 * Assets, Automations): one component rather than a copy per page. A panel that would only
 * repeat a Settings form links to its owner through `settingsHref` instead.
 */
export function ConfigureRegistrar({
  title,
  settingsHref,
  children,
}: {
  title: string;
  settingsHref: string;
  children: ReactNode;
}) {
  return (
    <SupportRegistrar mode="configure" title={title} href={settingsHref} hrefLabel="Full settings">
      {children}
    </SupportRegistrar>
  );
}
