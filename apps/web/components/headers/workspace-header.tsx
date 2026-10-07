'use client';

import type { ReactNode } from 'react';
import { Separator } from '@gold/ui/components/separator';
import { SidebarTrigger } from '@gold/ui/components/sidebar';
import { cx } from '../class-names';
import { WorkspaceCrumbSlot } from '../navigation/workspace-crumbs';
import { AgentTrigger } from '../panels/workspace-right-rail';
import { Users, Plug } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gold/ui/components/tooltip';
import { ButtonLink } from '../controls/button';
import type { HeaderUtility } from '@/lib/shell';

/**
 * The sticky GLOBAL workspace bar, shared by Organization Context, Platform Context and Account:
 * it answers *where am I* (the breadcrumb trail) and holds global utilities. It carries no page
 * title and no page actions — those are `PageHeader`, inside the page. The trail is written by
 * the page (`PageHeader`'s `crumbs`) into the slot here. It holds no business identifier, no
 * platform routing, no authorization, no Agent data.
 *
 * Left to right: the sidebar trigger, a mobile-only context control, the breadcrumb slot, a
 * spacer, an optional `beforeActions` control, and Agent — always the furthest-right control.
 */
export function WorkspaceHeader({
  navigationTrigger,
  context,
  beforeActions,
  utilities = [],
  agentTrigger = 'always',
}: {
  /**
   * 'md' — the sidebar trigger and its separator appear only from `md` up. Business *and*
   * Platform Context use this: Platform shares the application frame, so a phone gets the
   * bottom bar (`OrgNavBar`: Home, AI, Menu), whose Menu opens the sidebar's own phone Sheet, and the
   * header carries no sidebar trigger below that width.
   * 'always' — the trigger shows at every width, for a shell with no bottom bar whose only phone
   * navigation *is* the sidebar's off-canvas Sheet (Personal settings and the fallback frame).
   * Omit where no sidebar sits behind this header.
   */
  navigationTrigger?: 'always' | 'md';
  /**
   * A mobile-only identity/context control — a compact context switcher — for a shell whose own
   * sidebar (and therefore its own switcher) is not reachable at this width. Absent where it is.
   */
  context?: ReactNode;
  /** Rendered immediately before Agent. A generic slot: the organization shell leaves it empty, since its
   * phone Account lives in the Menu sheet's footer. */
  beforeActions?: ReactNode;
  /** Already authorized organization-wide utility destinations. */
  utilities?: HeaderUtility[];
  /**
   * 'md' — the Agent trigger shows only from `md` up, for a shell whose phone bottom bar carries its own
   * AI control. Default 'always', for shells with no bottom bar.
   */
  agentTrigger?: 'always' | 'md';
}) {
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
      {navigationTrigger ? (
        <>
          <SidebarTrigger
            className={cx(navigationTrigger === 'md' ? 'hidden -ml-2 md:flex' : '-ml-1')}
          />
          <Separator
            orientation="vertical"
            className={cx(
              'data-[orientation=vertical]:h-4',
              navigationTrigger === 'md' ? 'hidden md:block' : undefined,
            )}
          />
        </>
      ) : null}
      {context}
      <WorkspaceCrumbSlot />
      <span className="flex-1" />
      {beforeActions}
      <div className={cx('items-center gap-2', agentTrigger === 'md' ? 'hidden md:flex' : 'flex')}>
        <div className="hidden items-center gap-2 md:flex">
          {utilities.map((utility) => {
            const Icon = utility.key === 'team' ? Users : Plug;
            return (
              <Tooltip key={utility.key}>
                <TooltipTrigger asChild>
                  <ButtonLink href={utility.href} aria-label={utility.label} size="small" className="size-9 p-0 [&_svg]:size-5">
                    <Icon aria-hidden size={20} />
                  </ButtonLink>
                </TooltipTrigger>
                <TooltipContent>{utility.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <AgentTrigger />
      </div>
    </header>
  );
}
