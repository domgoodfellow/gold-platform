'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@gold/ui/components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gold/ui/components/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@gold/ui/components/sidebar';
import { Building2, ChevronsUpDown, Globe } from 'lucide-react';
import { Button } from '@/components/controls/button';
import type { OperationalState } from '@/lib/domain/tenancy/lifecycle';
import { organizationHomeHref } from '@/lib/navigation';
import { inPlatformContext } from '@/lib/route/platform-context';

export const GOLD_MARK = (
  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
    G
  </span>
);

export type SwitchableOrganization = {
  id: string;
  name: string;
  role: string;
  operationalState: OperationalState;
};

export type SwitcherContext =
  | { kind: 'business'; organizationId: string; name: string; role: string }
  | { kind: 'account' }
  /** The fallback frame: no organization is trusted, so the trigger names only GOLD. */
  | { kind: 'global' };

type SwitcherProps = {
  mark: ReactNode;
  current: SwitcherContext;
  organizations: SwitchableOrganization[];
  /** Server-resolved (`platformAdministrationAvailable`). Presentation only — `/platform` checks for itself. */
  platformAdministration?: boolean;
};

/**
 * One identity, its businesses, optionally Platform Administration, and exactly one current
 * context. The current context is the header of the menu and is never repeated in the list, so the
 * list is always *where else can I go*. Platform is a path (`/platform/**`), not a business:
 * inside it the shell is GOLD's, but the context is Platform, and GOLD is one of the places to go.
 */
function deriveSwitcherView(
  current: SwitcherContext,
  organizations: SwitchableOrganization[],
  platformAdministration: boolean,
  pathname: string,
) {
  const inPlatform = current.kind === 'business' && inPlatformContext(pathname);

  const triggerName = inPlatform
    ? 'Platform Administration'
    : current.kind === 'business'
      ? current.name
      : current.kind === 'global'
        ? 'GOLD'
        : 'Personal settings';
  const triggerRole = inPlatform
    ? 'Global tools'
    : current.kind === 'business'
      ? current.role
      : current.kind === 'global'
        ? 'Choose where to work'
        : 'Your identity';
  const avatarInitial = inPlatform
    ? 'P'
    : current.kind === 'business'
      ? triggerName.charAt(0).toUpperCase()
      : current.kind === 'global'
        ? 'G'
        : 'A';
  const businesses =
    current.kind === 'business' && !inPlatform
      ? organizations.filter((organization) => organization.id !== current.organizationId)
      : organizations;
  const platform = platformAdministration && !inPlatform;

  return { triggerName, triggerRole, avatarInitial, businesses, platform, hasChoices: businesses.length > 0 || platform };
}

function ContextSwitcherMenuContent({
  triggerName,
  triggerRole,
  avatarInitial,
  businesses,
  platform,
}: SwitcherProps & ReturnType<typeof deriveSwitcherView>) {
  return (
    <DropdownMenuContent side="bottom" align="start" className="w-64 min-w-64">
      <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2">
        <Avatar>
          <AvatarFallback>{avatarInitial}</AvatarFallback>
        </Avatar>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{triggerName}</span>
          <span className="block truncate text-xs font-normal text-muted">{triggerRole}</span>
        </span>
      </DropdownMenuLabel>

      {businesses.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="px-2 text-xs uppercase tracking-wide text-subtle">
            Businesses
          </DropdownMenuLabel>
          {businesses.map((organization) => (
            <DropdownMenuItem key={organization.id} asChild>
              <Link href={organizationHomeHref(organization.id, organization.operationalState)} className="flex items-center gap-2">
                <Building2 className="shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{organization.name}</span>
                  <span className="truncate text-xs text-muted">{organization.role}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}

      {platform ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/platform" className="flex items-center gap-2">
              <Globe className="shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">Platform Administration</span>
                <span className="truncate text-xs text-muted">Global tools</span>
              </span>
            </Link>
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}

export function ContextSwitcher({ mark, current, organizations, platformAdministration = false }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations, platformAdministration, usePathname());

  // Nowhere else to go: a label, not a menu with nothing in it.
  if (!view.hasChoices) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild size="lg" tooltip={view.triggerName} className="cursor-default hover:bg-transparent">
            <div>
              {mark}
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{view.triggerName}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">{view.triggerRole}</span>
              </div>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={view.triggerName}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {mark}
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="flex items-center gap-1">
                  <span className="truncate font-semibold">{view.triggerName}</span>
                  <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">{view.triggerRole}</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <ContextSwitcherMenuContent
            mark={mark}
            current={current}
            organizations={organizations}
            {...view}
          />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function CompactContextSwitcher({ mark, current, organizations, platformAdministration = false }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations, platformAdministration, usePathname());

  if (!view.hasChoices) {
    return (
      <span aria-label={view.triggerName} className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded">
        {mark}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          size="small"
          aria-label={`Switch context - currently ${view.triggerName}`}
          className="gap-1 px-2"
        >
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded">
            {mark}
          </span>
          <ChevronsUpDown aria-hidden size={14} />
        </Button>
      </DropdownMenuTrigger>
      <ContextSwitcherMenuContent
        mark={mark}
        current={current}
        organizations={organizations}
        {...view}
      />
    </DropdownMenu>
  );
}
