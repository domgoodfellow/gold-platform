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
import { Building2, ChevronsUpDown, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/controls/button';

/** One business the caller can switch into — never more than `listMyOrganizations` itself would return under the caller's own RLS. */
export type SwitchableOrganization = {
  id: string;
  name: string;
  role: string;
};

export type SwitcherContext =
  | { kind: 'business'; organizationId: string; name: string; role: string }
  | { kind: 'platform' };

type SwitcherProps = {
  mark: ReactNode;
  current: SwitcherContext;
  organizations: SwitchableOrganization[];
  platformStaff: boolean;
};

/**
 * "Where am I operating?" — never anything else. A link into a business's settings used to live
 * here too; it had no context-switching purpose and Settings already has a proper product
 * destination, so it is gone rather than making this a miscellaneous business menu.
 */
function deriveSwitcherView(current: SwitcherContext, organizations: SwitchableOrganization[]) {
  const triggerName = current.kind === 'business' ? current.name : 'Platform Administration';
  const triggerRole = current.kind === 'business' ? current.role : 'GOLD staff';
  const avatarInitial = current.kind === 'business' ? triggerName.charAt(0).toUpperCase() : 'G';

  // Never the current business itself — a row that navigates to where you already are is not a
  // switch. Platform Administration has no such filtering to do: there is only one of it.
  const businesses =
    current.kind === 'business'
      ? organizations.filter((organization) => organization.id !== current.organizationId)
      : organizations;

  return { triggerName, triggerRole, avatarInitial, businesses };
}

/**
 * The one shared menu body — WHERE the signed-in identity is currently operating, rendered
 * identically regardless of which trigger opened it. It holds no authorization logic and grants
 * nothing on its own: every row links to an existing route (`/organizations/{id}`, `/platform`),
 * and `organizations`/`platformStaff` are exactly what `listMyOrganizations`/`isPlatformStaff`
 * returned under the caller's own RLS.
 */
function ContextSwitcherMenuContent({
  current,
  platformStaff,
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
              <Link href={`/organizations/${organization.id}`} className="flex items-center gap-2">
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

      {/* The current context is never repeated inside its own group — Platform Administration is
          already the trigger's own label, so there is nothing left to offer here besides the fact
          that this identity also holds it (shown above). */}
      {platformStaff && current.kind !== 'platform' ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="px-2 text-xs uppercase tracking-wide text-subtle">
            Platform
          </DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/platform">
              <ShieldCheck /> Platform Administration
            </Link>
          </DropdownMenuItem>
        </>
      ) : null}

      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/organizations?all=1">All businesses</Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

/**
 * WHERE the signed-in identity is currently operating — Business Context or Platform
 * Administration — rendered identically in both shells so that a caller holding both facts (D45)
 * never has to leave the header to move between them. Business Context and Platform
 * Administration remain two different navigation models (`ui-spec.md` §1, D23) — this component
 * is the one thing both render, not a merger of the two into one.
 *
 * The `Sidebar` trigger, for use inside a desktop/tablet sidebar header (`OrgSidebar`,
 * `AppSidebar`). `CompactContextSwitcher` below is the same menu content behind a trigger that
 * fits a phone header, where no sidebar is reachable at all.
 */
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

/**
 * The same menu, behind a trigger sized for a phone header rather than a `Sidebar` row — Business
 * Context's phone width, where `OrgNavBar` carries navigation instead of the permanent sidebar
 * and its switcher would otherwise be unreachable without typing a URL.
 */
export function CompactContextSwitcher({ mark, current, organizations, platformStaff }: SwitcherProps) {
  const view = deriveSwitcherView(current, organizations);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          size="small"
          aria-label={`Switch business — currently ${view.triggerName}`}
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
