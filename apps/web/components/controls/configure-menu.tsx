'use client';

import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { Button, type ButtonSize } from './button';
import { ConfigureLink } from './configure-link';

/**
 * A workspace's one Configure entry. It carries only the doors the member may configure (see
 * `workspaceConfigureItems`): none renders nothing, so there is never a button that leads nowhere;
 * one is a plain link, named for what it configures; several are a menu. Each door is a registered
 * configuration target — this control owns no path of its own. Doors that open an Organization
 * Settings page (`owner: 'settings'`) are grouped under that heading after the workspace's own, so a
 * workspace never presents a business-wide setting as if it owned it.
 */
/** `compact` keeps only the icon on a phone (the name stays for assistive technology), for a header that must stay one row. */
export function ConfigureMenu({ items, size, compact = false }: { items: { key: string; label: string; href: string; owner?: 'settings' }[]; size?: ButtonSize; compact?: boolean }) {
  if (items.length === 0) return null;
  if (items.length === 1) return <ConfigureLink size={size} compact={compact} href={items[0].href} label={items[0].label} title={items[0].owner ? `${items[0].label} (Organization settings)` : items[0].label} />;
  const own = items.filter((item) => !item.owner);
  const shared = items.filter((item) => item.owner);
  const link = (item: (typeof items)[number]) => (
    <DropdownMenuItem key={item.key} asChild>
      <Link href={item.href}>{item.label}</Link>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button tone="secondary" size={size}><Settings2 aria-hidden /> <span className={compact ? 'max-sm:sr-only' : undefined}>Configure</span></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {own.map(link)}
        {shared.length ? (
          <DropdownMenuGroup aria-label="Organization settings">
            {own.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs font-medium text-muted">Organization settings</DropdownMenuLabel>
            {shared.map(link)}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
