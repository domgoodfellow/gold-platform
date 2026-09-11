'use client';

import Link from 'next/link';
import { Building2, ChevronUp, LogOut, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cx, FOCUS_RING } from '@/components/class-names';
import { useSidebarCollapsed } from './app-shell';

/** The truthful, shared person/session menu used by tenant and platform shells. */
export function AccountMenu({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const collapsed = useSidebarCollapsed();
  const trigger = (
    <button
      type="button"
      aria-label="Account menu"
      className={cx(
        FOCUS_RING,
        'flex h-10 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10',
        collapsed ? 'justify-center px-0' : 'md:justify-center md:px-0 lg:justify-start lg:px-3',
      )}
    >
      <Avatar size="sm"><AvatarFallback>U</AvatarFallback></Avatar>
      <span className={cx('min-w-0 flex-1', collapsed ? 'hidden' : 'md:hidden lg:block')}>
        <span className="block truncate font-medium">Account</span>
      </span>
      <ChevronUp aria-hidden size={14} className={cx('shrink-0', collapsed ? 'hidden' : 'md:hidden lg:block')} />
    </button>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild><DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger></TooltipTrigger>
          <TooltipContent side="right">Account</TooltipContent>
        </Tooltip>
      ) : <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>}
      <DropdownMenuContent side="top" align="start" className="w-64 min-w-64">
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2">
          <Avatar><AvatarFallback>U</AvatarFallback></Avatar>
          <span className="min-w-0"><span className="block text-sm font-medium">Signed-in account</span><span className="block truncate text-xs font-normal text-muted">Account destinations</span></span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/organizations?all=1"><Building2 /> Your businesses</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild variant="destructive"><button type="submit"><LogOut /> Log out</button></DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
