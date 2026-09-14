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
import { Building2, ChevronsUpDown, Settings, ShieldCheck } from 'lucide-react';
import { areaHref } from '@/lib/navigation';

/** One business the caller can switch into — never more than `listMyOrganizations` itself would return under the caller's own RLS. */
export type SwitchableOrganization = {
  id: string;
  name: string;
  role: string;
};

export type SwitcherContext =
  | { kind: 'business'; organizationId: string; name: string; role: string }
  | { kind: 'platform' };

/**
 * WHERE the signed-in identity is currently operating — Business Context or Platform
 * Administration — rendered identically in both shells so that a caller holding both facts
 * (D45) never has to leave the header to move between them. This does not decide what either
 * context may do: `organizations` is exactly what `listMyOrganizations` returned under the
 * caller's own RLS, and `platformStaff` is `isPlatformStaff`'s own live answer. The switcher
 * only ever links to an existing route (`/organizations/{id}`, `/platform`) — it holds no
 * authorization logic and grants nothing on its own.
 *
 * Business Context and Platform Administration remain two different navigation models
 * (`ui-spec.md` §1, D23) — this component is the one thing both render, not a merger of the
 * two into one.
 */
export function ContextSwitcher({
  mark,
  current,
  organizations,
  platformStaff,
}: {
  mark: ReactNode;
  current: SwitcherContext;
  organizations: SwitchableOrganization[];
  platformStaff: boolean;
}) {
  const triggerName = current.kind === 'business' ? current.name : 'Platform Administration';
  const triggerRole = current.kind === 'business' ? current.role : 'GOLD staff';
  const avatarInitial = current.kind === 'business' ? triggerName.charAt(0).toUpperCase() : 'G';

  // Never the current business itself — a row that navigates to where you already are is not
  // a switch. Platform Administration has no such filtering to do: there is only one of it.
  const businesses =
    current.kind === 'business'
      ? organizations.filter((organization) => organization.id !== current.organizationId)
      : organizations;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={triggerName}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {mark}
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="flex items-center gap-1">
                  <span className="truncate font-semibold">{triggerName}</span>
                  <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">{triggerRole}</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
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

            {current.kind === 'business' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={areaHref(current.organizationId, 'settings')}>
                    <Settings /> Organization settings
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}

            {businesses.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 text-xs uppercase tracking-wide text-subtle">
                  Businesses
                </DropdownMenuLabel>
                {businesses.map((organization) => (
                  <DropdownMenuItem key={organization.id} asChild>
                    <Link href={`/organizations/${organization.id}`}>
                      <Building2 /> {organization.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}

            {/* The current context is never repeated inside its own group — Platform
                Administration is already the trigger's own label, so there is nothing left to
                offer here besides the fact that this identity also holds it (shown above). */}
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
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
