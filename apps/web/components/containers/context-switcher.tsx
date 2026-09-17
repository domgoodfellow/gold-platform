'use client';

import Link from 'next/link';
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
import { Building2, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/controls/button';
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
};

export type SwitcherContext =
  | { kind: 'business'; organizationId: string; name: string; role: string }
  | { kind: 'account' };

type SwitcherProps = {
  mark: ReactNode;
  current: SwitcherContext;
  organizations: SwitchableOrganization[];
  platformStaff: boolean;
};

function deriveSwitcherView(current: SwitcherContext, organizations: SwitchableOrganization[]) {
  const triggerName = current.kind === 'business' ? current.name : 'Your account';
  const triggerRole = current.kind === 'business' ? current.role : 'Personal';
  const avatarInitial = current.kind === 'business' ? triggerName.charAt(0).toUpperCase() : 'A';
  const businesses =
    current.kind === 'business'
      ? organizations.filter((organization) => organization.id !== current.organizationId)
      : organizations;

  return { triggerName, triggerRole, avatarInitial, businesses };
}

function ContextSwitcherMenuContent({
  triggerName,
  triggerRole,
  avatarInitial,
  businesses,
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
              <Link href={organizationHomeHref(organization.id)} className="flex items-center gap-2">
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

      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/organizations?all=1">All businesses</Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function ContextSwitcher({ mark, current, organizations, platformStaff }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations);

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
            platformStaff={platformStaff}
            {...view}
          />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function CompactContextSwitcher({ mark, current, organizations, platformStaff }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          size="small"
          aria-label={`Switch business - currently ${view.triggerName}`}
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
        platformStaff={platformStaff}
        {...view}
      />
    </DropdownMenu>
  );
}
