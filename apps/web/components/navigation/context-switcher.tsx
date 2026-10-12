'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PLATFORM_NAME } from '@/lib/brand';
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
import { Building2, ChevronsUpDown, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/controls/button';
import type { OperationalState } from '@/lib/domain/tenancy/lifecycle';
import { organizationHomeHref } from '@/lib/navigation';

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
  /** The fallback frame: no organization is trusted, so the trigger names only the platform. */
  | { kind: 'platform'; organizationId: string }
  | { kind: 'global' };

export type PlatformContext = { organizationId: string; href: string };

type SwitcherProps = {
  mark: ReactNode;
  current: SwitcherContext;
  organizations: SwitchableOrganization[];
  platform?: PlatformContext | null;
};

/** Businesses and the separately authorized system control plane share one switcher. */
export function deriveSwitcherView(current: SwitcherContext, organizations: SwitchableOrganization[], platform?: PlatformContext | null) {
  const triggerName =
    current.kind === 'business' ? current.name : current.kind === 'platform' ? `${PLATFORM_NAME} Platform` : PLATFORM_NAME;
  const triggerRole =
    current.kind === 'business' ? current.role : current.kind === 'platform' ? 'System control plane' : 'Choose where to work';
  const avatarInitial =
    current.kind === 'business' ? triggerName.charAt(0).toUpperCase() : 'G';
  const businesses =
    current.kind === 'business'
      ? organizations.filter((organization) => organization.id !== current.organizationId)
      : organizations;

  return { triggerName, triggerRole, avatarInitial, businesses, hasChoices: businesses.length > 0 || !!platform };
}

function ContextSwitcherMenuContent({
  triggerName,
  triggerRole,
  avatarInitial,
  businesses,
  platform,
  current,
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
          <DropdownMenuLabel className="px-2 text-xs uppercase tracking-wide text-subtle">System</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href={platform.href} aria-current={current.kind === 'platform' ? 'page' : undefined} className="flex items-center gap-2">
              <LayoutDashboard aria-hidden className="shrink-0" />
              <span>Platform</span>
            </Link>
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}

export function ContextSwitcher({ mark, current, organizations, platform }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations, platform);

  // Nowhere else to go: a label, not a menu with nothing in it. `asChild` swaps the underlying
  // element for a non-interactive `<div>` — which means the button's own `flex` row classes land
  // on that div too (Slot merges them onto the one child), so the row inside stays plain flex
  // children rather than a nested `grid` that would fight the merged `flex` for `display`.
  if (!view.hasChoices) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            size="lg"
            tooltip={view.triggerName}
            className="cursor-default justify-center hover:bg-transparent"
          >
            <div>
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded">{mark}</span>
              <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold group-data-[collapsible=icon]:hidden">
                {view.triggerName}
                {current.kind === 'platform' ? <span className="block text-xs font-normal text-muted">{view.triggerRole}</span> : null}
              </span>
              {/* Balances the mark's width on the other side, so the centered name lands in the
                  middle of the whole row rather than the middle of the space left of it. */}
              <span aria-hidden className="size-8 shrink-0 group-data-[collapsible=icon]:hidden" />
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
              className="justify-center data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {/* Symmetric identity row when expanded — mark, centered name, chevron, the mark and
                  chevron each a same-size (2rem) flex item — so the name is genuinely centered
                  rather than left-aligned beside a wide mark column. Collapsed, the row falls back
                  to the mark alone, centered by the row's own `justify-center` above. */}
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded">{mark}</span>
              <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold group-data-[collapsible=icon]:hidden">
                {view.triggerName}
                {current.kind === 'platform' ? <span className="block text-xs font-normal text-muted">{view.triggerRole}</span> : null}
              </span>
              <span className="flex size-8 shrink-0 items-center justify-center group-data-[collapsible=icon]:hidden">
                <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <ContextSwitcherMenuContent
            mark={mark}
            current={current}
            organizations={organizations}
            platform={platform}
            {...view}
          />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Noninteractive identity for restricted shells. */
export function ContextIdentity({ mark, name, role }: { mark: ReactNode; name: string; role: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-2">
      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded">{mark}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-muted">{role}</span>
      </span>
    </div>
  );
}

export function CompactContextSwitcher({ mark, current, organizations, platform }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations, platform);

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
        platform={platform}
        {...view}
      />
    </DropdownMenu>
  );
}
