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

/** Shared page-location bar; phone navigation sits at the far right. */
export function WorkspaceHeader({
  navigationTrigger,
  context,
  beforeActions,
  utilities = [],
  agentTrigger = 'always',
}: {
  navigationTrigger?: 'always' | 'md';
  context?: ReactNode;
  /** Rendered immediately before Agent. A generic slot: the organization shell leaves it empty, since its
   * phone Account lives in the Menu sheet's footer. */
  beforeActions?: ReactNode;
  /** Already authorized organization-wide utility destinations. */
  utilities?: HeaderUtility[];
  /** Use 'md' when mobile navigation carries Agent. */
  agentTrigger?: 'always' | 'md';
}) {
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
      {navigationTrigger ? (
        <>
          <SidebarTrigger
            className={cx('shrink-0 order-last md:order-none', navigationTrigger === 'md' ? 'hidden -ml-2 md:flex' : 'md:-ml-2')}
          />
          <Separator
            orientation="vertical"
            className={cx(
              'data-[orientation=vertical]:h-4',
              'hidden md:block',
            )}
          />
        </>
      ) : null}
      {context}
      <WorkspaceCrumbSlot />
      <span className="hidden flex-1 md:block" />
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
