'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useContext, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Search, Settings2 } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@gold/ui/components/sidebar';
import { activeItemKey, type ShellSection } from '@/lib/shell';
import type { SettingsSearchItem } from '@/lib/settings-nav';
import { safeAppReturnPath, lastAppPathKey } from '@/lib/route/app-return';

import { NavigationActivityContext } from './activity-context';
import { SETTINGS_ICONS } from './settings-icons';

const subscribeNothing = () => () => {};

/** Where "Back to app" goes: the last workspace page seen in this tab, if it is still a valid page of this business, else Home. */
function useBackHref(organizationId: string, allowedHrefs: readonly string[]): string {
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
  return safeAppReturnPath(stored, organizationId, allowedHrefs) ?? `/organizations/${organizationId}`;
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
  returnHrefs,
}: {
  organizationId: string;
  organizationName: string;
  sections: ShellSection[];
  search: SettingsSearchItem[];
  returnHrefs: readonly string[];
}) {
  const pathname = usePathname();
  const preserveActivity = useContext(NavigationActivityContext);
  const retainInSeparateTab = (href: string) => preserveActivity && !href.startsWith(`/organizations/${organizationId}/`);
  const { setOpenMobile } = useSidebar();
  const active = activeItemKey(sections, pathname);
  const backHref = useBackHref(organizationId, returnHrefs);
  const [query, setQuery] = useState('');
  // Spacing is ignored on both sides, so "timezone" finds "time zone".
  const squash = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, '');
  const normalised = squash(query);
  const results = normalised ? search.filter((entry) => squash(`${entry.label} ${entry.description} ${entry.keywords ?? ''}`).includes(normalised)) : [];

  return (
    <nav aria-label="Settings" className="flex flex-1 flex-col" onClick={(event) => { if ((event.target as Element).closest('a[href]')) setOpenMobile(false); }}>
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
        <p className="truncate text-sm font-medium">Settings</p>
        <label className="relative mt-3 block">
          <span className="sr-only">Search settings</span>
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/60" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            className="h-8 w-full rounded-md border border-sidebar-border bg-transparent pl-8 pr-2 text-sm outline-none"
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
                      <Link target={retainInSeparateTab(entry.href) ? "_blank" : undefined} rel={retainInSeparateTab(entry.href) ? "noopener noreferrer" : undefined} title={retainInSeparateTab(entry.href) ? "Opens in a new tab to retain the active call" : undefined} href={entry.href} aria-label={entry.label} onClick={() => setQuery('')}><Settings2 aria-hidden />
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
                {section.items.map((item) => {
                  const Icon = SETTINGS_ICONS[item.key];
                  return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={item.key === active} tooltip={item.label}>
                      <Link target={retainInSeparateTab(item.href) ? "_blank" : undefined} rel={retainInSeparateTab(item.href) ? "noopener noreferrer" : undefined} title={retainInSeparateTab(item.href) ? "Opens in a new tab to retain the active call" : undefined} href={item.href} aria-label={item.label} aria-current={item.key === active ? 'page' : undefined}>
                        <Icon aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ); })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))
      )}
    </nav>
  );
}
