'use client';

import Link from 'next/link';
import {
  Cable,
  CreditCard,
  Settings,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  Wrench,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gold/ui/components/dropdown-menu';
import { cx, FOCUS_RING } from '@/components/class-names';

/**
 * Organization administration belongs in the shell, not in the permanent work navigation.
 * The sidebar answers "where do I work?"; this menu answers "how is this business configured?".
 * Every destination below already exists and remains directly addressable/bookmarkable.
 */
export function OrganizationAdminMenu({ organizationId }: { organizationId: string }) {
  const root = `/organizations/${organizationId}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Configure this business"
          title="Configure this business"
          className={cx(
            FOCUS_RING,
            'inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
          )}
        >
          <Settings aria-hidden size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>This business</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={`${root}/settings`}><SlidersHorizontal /> Configuration center</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${root}/settings/work`}><Wrench /> Work & scheduling</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${root}/roles`}><UsersRound /> People & roles</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Plan & connections</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={`${root}/settings/plan`}><CreditCard /> Plan & usage</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${root}/settings/connections`}><Cable /> Provider connections</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${root}/integrations`}><Cable /> Integrations</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account"><UserRound /> Account</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
