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
import { Building2, ChevronsUpDown, LogOut, Settings, UserRound } from 'lucide-react';
import { Button } from '@/components/controls/button';
import type { OperationalState } from '@/lib/domain/tenancy/lifecycle';
import { organizationHomeHref } from '@/lib/navigation';
import { personalSettingsHref } from '@/lib/route/personal-settings';

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
  | { kind: 'global' };

type SwitcherProps = {
  mark: ReactNode;
  current: SwitcherContext;
  organizations: SwitchableOrganization[];
};

/**
 * One identity, its businesses, and exactly one current context. The current context is the header
 * of the menu and is never repeated in the list, so the list is always *where else can I go*. The
 * switcher answers one question — **which organization am I operating?** — and nothing else:
 * Platform is not an organization and is not offered here. Platform tools appear in GOLD's own
 * shell, for an operator holding the permission, and `/platform/**` renders inside that shell, so
 * the current context there is GOLD.
 */
export function deriveSwitcherView(current: SwitcherContext, organizations: SwitchableOrganization[]) {
  const triggerName =
    current.kind === 'business' ? current.name : PLATFORM_NAME;
  const triggerRole =
    current.kind === 'business' ? current.role : 'Choose where to work';
  const avatarInitial =
    current.kind === 'business' ? triggerName.charAt(0).toUpperCase() : 'G';
  const businesses =
    current.kind === 'business'
      ? organizations.filter((organization) => organization.id !== current.organizationId)
      : organizations;

  return { triggerName, triggerRole, avatarInitial, businesses, hasChoices: businesses.length > 0 };
}

function ContextSwitcherMenuContent({
  current,
  triggerName,
  triggerRole,
  avatarInitial,
  businesses,
  email,
  signOutAction,
}: SwitcherProps & ReturnType<typeof deriveSwitcherView> & {
  email?: string;
  signOutAction?: () => Promise<void>;
}) {
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

      {current.kind === 'business' && email && signOutAction ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/organizations/${current.organizationId}/settings`}>
              <Settings />Organization settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={personalSettingsHref('profile', current.organizationId)}>
              <UserRound />Personal settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="truncate px-2 text-xs font-normal text-muted">{email}</DropdownMenuLabel>
          <DropdownMenuItem variant="destructive" onClick={() => { void signOutAction(); }}>
            <LogOut />Sign out
          </DropdownMenuItem>
        </>
      ) : null}

    </DropdownMenuContent>
  );
}

export function ContextSwitcher({ mark, current, organizations }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations);

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

export function CompactContextSwitcher({ mark, current, organizations }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations);

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

/** One phone control for business, role, switching, organization settings and account actions. */
export function CompactOperatorMenu({
  mark,
  current,
  organizations,
  email,
  signOutAction,
}: SwitcherProps & { email: string; signOutAction: () => Promise<void> }) {
  const view = deriveSwitcherView(current, organizations);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          size="small"
          aria-label={`${view.triggerName}, ${view.triggerRole}. Open organization and account menu`}
          className="min-w-0 gap-2 px-2"
        >
          <span aria-hidden className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded">
            {mark}
          </span>
          <span className="max-w-32 truncate font-medium">{view.triggerName}</span>
          <ChevronsUpDown aria-hidden size={14} className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <ContextSwitcherMenuContent
        mark={mark}
        current={current}
        organizations={organizations}
        email={email}
        signOutAction={signOutAction}
        {...view}
      />
    </DropdownMenu>
  );
}
