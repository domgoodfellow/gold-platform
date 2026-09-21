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
import { useWorkspaceRail, type SupportMode } from './workspace-right-rail';

/**
 * One page-support mode's content, opened by that page's `SupportTrigger`. `children` is
 * server-rendered JSX handed down as a prop, so the same markup, the same server actions and the
 * same validation run whether it is opened from here or from its own full page.
 *
 * Every mode is this one component over the one `PageDrawer`, keyed by `supportMode` — which holds
 * a single value, so a page registering Activity, Insights and Configure never has two open, and
 * switching between them reuses the rail rather than stacking a drawer on a drawer.
 *
 * `href` is the full-page owner of the same subject: Settings for Configure, Insights for
 * Insights. A rail is a summary of somewhere, never a second copy of it.
 */
export function SupportRegistrar({
  mode,
  title,
  href,
  hrefLabel,
  children,
}: {
  mode: SupportMode;
  title: string;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
}) {
  const { supportMode, setSupportMode } = useWorkspaceRail();

  // Leaving the page closes its drawer, so the next page never opens with one already showing.
  // Functional, so a registrar unmounting for another mode cannot close the mode now open.
  useEffect(
    () => () => setSupportMode((current) => (current === mode ? null : current)),
    [mode, setSupportMode],
  );

  return (
    <PageDrawer open={supportMode === mode} onOpenChange={(open) => setSupportMode(open ? mode : null)}>
      <PageDrawerContent className="gap-0">
        <PageDrawerHeader inline className="border-b border-border">
          <PageDrawerTitle>{title}</PageDrawerTitle>
          {href ? (
            <Link
              href={href}
              className={cx('flex shrink-0 items-center gap-1 text-xs text-muted underline-offset-4 hover:underline', FOCUS_RING)}
            >
              {hrefLabel ?? 'Open'}
              <ArrowRight aria-hidden size={12} />
            </Link>
          ) : null}
        </PageDrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col p-4">{children}</div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
