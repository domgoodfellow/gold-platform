'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@gold/ui/components/sidebar';
import { activeItemKey, type ShellSection } from '@/lib/shell';
import type { SettingsSearchItem } from '@/lib/settings-nav';
import { safeAppReturnPath, lastAppPathKey } from '@/lib/route/app-return';

const subscribeNothing = () => () => {};

/** Where "Back to app" goes: the last workspace page seen in this tab, if it is still a valid page of this business, else Home. */
function useBackHref(organizationId: string): string {
  const stored = useSyncExternalStore(
    subscribeNothing,
    () => {
      try {
        return window.sessionStorage.getItem(lastAppPathKey(organizationId));
      } catch {
        return null;
      }
    },
    () => null,
  );
  return safeAppReturnPath(stored, organizationId) ?? `/organizations/${organizationId}`;
}

/**
 * The sidebar while a person is inside Settings: the shell's own `Sidebar`, showing Settings
 * destinations instead of the nine workspaces. Search reaches both these destinations and the
 * configuration that workspaces own, and routes each to its canonical owner.
 */
export function SettingsNav({
  organizationId,
  organizationName,
  sections,
  search,
}: {
  organizationId: string;
  organizationName: string;
  sections: ShellSection[];
  search: SettingsSearchItem[];
}) {
  const pathname = usePathname();
  const active = activeItemKey(sections, pathname);
  const backHref = useBackHref(organizationId);
  const [query, setQuery] = useState('');
  // Spacing is ignored on both sides, so "timezone" finds "time zone".
  const squash = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, '');
  const normalised = squash(query);
  const results = normalised ? search.filter((entry) => squash(`${entry.label} ${entry.description} ${entry.keywords ?? ''}`).includes(normalised)) : [];

  return (
    <nav aria-label="Settings" className="flex flex-1 flex-col">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Back to app">
                <Link href={backHref}>
                  <ArrowLeft aria-hidden />
                  <span>Back to app</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <div className="px-4 pb-2 group-data-[collapsible=icon]:hidden">
        <p className="truncate text-xs text-sidebar-foreground/70">Settings for</p>
        <p className="truncate text-sm font-medium">{organizationName}</p>
        <label className="relative mt-3 block">
          <span className="sr-only">Search settings</span>
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/60" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            className="h-8 w-full rounded-md border border-sidebar-border bg-transparent pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          />
        </label>
      </div>

      {normalised ? (
        <SidebarGroup>
          <SidebarGroupLabel>Results</SidebarGroupLabel>
          <SidebarGroupContent>
            {results.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-sidebar-foreground/70">No settings match “{query.trim()}”.</p>
            ) : (
              <SidebarMenu>
                {results.map((entry) => (
                  <SidebarMenuItem key={entry.key}>
                    <SidebarMenuButton asChild className="h-auto py-1.5">
                      <Link href={entry.href} onClick={() => setQuery('')}>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{entry.label}</span>
                          {entry.description ? <span className="truncate text-xs text-sidebar-foreground/60">{entry.description}</span> : null}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      ) : (
        sections.map((section) => (
          <SidebarGroup key={section.key}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={item.key === active} tooltip={item.label}>
                      <Link href={item.href} aria-current={item.key === active ? 'page' : undefined}>
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))
      )}
    </nav>
  );
}
