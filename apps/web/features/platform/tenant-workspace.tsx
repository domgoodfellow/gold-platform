'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { cx, FOCUS_RING } from '@/components/class-names';
import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/headers/page-header';
import { platformAncestry, platformHref } from '@/lib/platform-navigation';

const sections = [['Overview', ''], ['Plan & Entitlements', '/commercial'], ['Providers', '/providers'], ['Integrations', '/integrations'], ['Usage', '/usage'], ['Failures', '/failures']] as const;

/**
 * A Platform view OF an organization — never the organization's own tenant shell. `canOpenBusiness`
 * is the one door between the two: true only when this platform-staff caller's own
 * `listMyOrganizations()` already includes this organization (real membership, not staff
 * authority standing in for one), so "Open business" never fabricates a tenant capability inside
 * `/platform` (ADR-003). Computed once, on the overview page, since a
 * membership fact doesn't change per tab.
 */
export function TenantWorkspaceHeader({
  goldId,
  id,
  name,
  currency,
  canOpenBusiness,
}: {
  /** GOLD's own organization — the context these pages are drawn in, not the organization being viewed. */
  goldId: string;
  id: string;
  name: string;
  currency: string;
  canOpenBusiness?: boolean;
}) {
  const pathname = usePathname();
  const base = platformHref(goldId, `organizations/${id}`);

  return (
    <>
      <PageHeader
        title={name}
        crumbs={[...platformAncestry(goldId, 'organizations'), { label: 'Organizations', href: platformHref(goldId, 'organizations') }]}
        actions={
          canOpenBusiness ? (
            <ButtonLink href={`/organizations/${id}`} tone="secondary" size="small" className="gap-1.5">
              Open business
              <ArrowUpRight aria-hidden size={14} />
            </ButtonLink>
          ) : null
        }
      />
      <Hint className="block">
        Tenant ID: {id} · Trades in {currency || 'an unconfigured currency'}.
      </Hint>
      <nav aria-label="Tenant workspace" className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {sections.map(([label, suffix]) => {
          const href = `${base}${suffix}`;
          const active = pathname === href;
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cx(FOCUS_RING, 'whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium', active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground')}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
