'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { Library } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from '@gold/ui/components/sidebar';
import { ViewNav } from '@/components/navigation/view-nav';
import { cx, FOCUS_RING } from '@/components/class-names';
import { activeLibrarySection, LIBRARY_SECTIONS, LIBRARY_TABS, libraryHref, type LibrarySectionKey } from '@/lib/route/library';

/** The section tab strip every Library page renders, so a section is one click away from any other. */
export function LibraryNav({ organizationId, active }: { organizationId: string; active: LibrarySectionKey }) {
  return <ViewNav label="Library" current={active} className="mb-6" views={LIBRARY_TABS.map(section => ({
    key: section.key, label: section.label, href: libraryHref(organizationId, section.key),
  }))} />;
}

/**
 * Library's one control in the primary sidebar group. It is a trigger, not a link: it opens an anchored
 * popover of the Library destinations, drawn from the same registry the routes are built from.
 * Choosing one navigates and closes the popover; Radix supplies Escape, outside-click dismissal, focus
 * return to the trigger, and collision-aware placement, so the list stays on screen on a phone.
 */
export function LibraryMenu({ organizationId, label = 'Library' }: { organizationId: string; label?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLElement>(null);
  const { isMobile } = useSidebar();
  const active = activeLibrarySection(organizationId, pathname);

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton isActive={active !== null} tooltip={label} aria-label={label}>
            <Library aria-hidden />
            <span>{label}</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          // On a phone the sidebar is a sheet on the right edge, so there is no room beside the trigger:
          // the list opens beneath it instead, aligned to its edge, and stays inside the viewport.
          side={isMobile ? 'bottom' : 'right'}
          align={isMobile ? 'end' : 'start'}
          sideOffset={8}
          collisionPadding={8}
          className="w-56 max-w-[calc(100vw-2rem)] p-1"
          // Keyboard users land on the destination they are in, or the first one.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (menu.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? menu.current?.querySelector<HTMLElement>('a'))?.focus();
          }}
        >
          <nav ref={menu} aria-label="Library destinations" className="max-h-[min(24rem,var(--radix-popover-content-available-height))] overflow-y-auto">
            <ul className="flex flex-col gap-0.5">
              {LIBRARY_SECTIONS.map((section) => {
                const current = section.key === active;
                return (
                  <li key={section.key}>
                    <Link
                      href={libraryHref(organizationId, section.key)}
                      aria-current={current ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={cx(
                        'flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-sidebar-accent md:min-h-8',
                        current && 'bg-sidebar-accent font-medium',
                        FOCUS_RING,
                      )}
                    >
                      {section.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
