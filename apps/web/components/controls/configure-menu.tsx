'use client';

import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
import { Button } from './button';
import { ConfigureLink } from './configure-link';

/**
 * A workspace's one Configure entry. It carries only the doors the member may configure (see
 * `workspaceConfigureItems`): none renders nothing, so there is never a button that leads nowhere;
 * one is a plain link, named for what it configures; several are a menu. Each door is a registered
 * configuration target — this control owns no path of its own.
 */
export function ConfigureMenu({ items }: { items: { key: string; label: string; href: string }[] }) {
  if (items.length === 0) return null;
  if (items.length === 1) return <ConfigureLink href={items[0].href} label={items[0].label} title={items[0].label} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button tone="secondary"><Settings2 aria-hidden /> Configure</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.key} asChild>
            <Link href={item.href}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
