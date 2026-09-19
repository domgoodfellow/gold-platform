'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cx, FOCUS_RING } from '../class-names';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
} from './page-drawer';
import { useWorkspaceRail } from './workspace-right-rail';

/**
 * A page's Configure drawer, opened by that page's `ConfigureTrigger`. `children` is
 * server-rendered JSX handed down as a prop, so the same markup, the same server actions and the
 * same validation run whether it's opened from here or from Settings.
 *
 * Shared by every workspace with a contextual Configure panel (Work, Schedule, Customers,
 * Resources, Locations, Assets, Automations) — one component rather than a copy per page.
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
  const { configureOpen, setConfigureOpen } = useWorkspaceRail();

  // Leaving the page closes its drawer, so the next page's Configure never opens by itself.
  useEffect(() => () => setConfigureOpen(false), [setConfigureOpen]);

  return (
    <PageDrawer open={configureOpen} onOpenChange={setConfigureOpen}>
      <PageDrawerContent className="gap-0">
        <PageDrawerHeader className="border-b border-border">
          <PageDrawerTitle>{title}</PageDrawerTitle>
          <Link
            href={settingsHref}
            className={cx('flex items-center gap-1 text-xs text-muted underline-offset-4 hover:underline', FOCUS_RING)}
          >
            Open full settings
            <ArrowRight aria-hidden size={12} />
          </Link>
        </PageDrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
