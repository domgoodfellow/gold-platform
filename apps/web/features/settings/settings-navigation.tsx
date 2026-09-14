'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';

/**
 * Three scopes, never flattened into one list (product architecture decision, 2026):
 *
 * - PERSONAL belongs to the signed-in identity, not this organization — Account leaves this
 *   route tree entirely (`/account`), the same way `ContextSwitcher` owns cross-business
 *   navigation rather than this component or `AccountMenu`.
 * - BUSINESS is how this organization operates — durable configuration an organization
 *   administrator sets.
 * - GOLD ACCOUNT is GOLD's own commercial relationship with this organization — the opposite
 *   money direction from Business Commerce, and never presented as an unlabeled sibling of it
 *   (`domain-model.md`'s two-planes table, made literal here).
 *
 * Every entry is a route. None is an anchor into a page listed elsewhere — the one page that
 * still holds more than one concern (`/settings` itself, Public presence and Getting paid) is
 * linked here as the single route it is; its own two internal ids exist only for `MODULES`'s
 * `configuredAt` links, not as a second navigation system layered under this one.
 */
type Entry = { label: string; segment: string | null };

function groups(organizationId: string): { heading: string; entries: { label: string; href: string }[] }[] {
  const root = `/organizations/${organizationId}/settings`;

  const business: Entry[] = [
    { label: 'General', segment: 'general' },
    { label: 'People & access', segment: 'people' },
    { label: 'Work & scheduling', segment: 'work' },
    { label: 'Public presence & payments', segment: null },
    { label: 'Website', segment: 'website' },
    { label: 'Data & automation', segment: 'data-automation' },
    { label: 'Business commerce', segment: 'commerce' },
    { label: 'Features', segment: 'features' },
    { label: 'Connections', segment: 'connections' },
  ];

  return [
    {
      heading: 'Personal',
      entries: [{ label: 'Account', href: '/account' }],
    },
    {
      heading: 'Business',
      entries: business.map((entry) => ({
        label: entry.label,
        href: entry.segment ? `${root}/${entry.segment}` : root,
      })),
    },
    {
      heading: 'GOLD Account',
      entries: [{ label: 'Plan & usage', href: `${root}/plan` }],
    },
  ];
}

/** A compact table of contents on phones and a persistent local navigation on larger screens. */
export function SettingsNavigation({ organizationId }: { organizationId: string }) {
  const pathname = usePathname();
  const activePath = pathname.replace(/\/$/, '');

  return (
    <nav aria-label="Settings" className="lg:sticky lg:top-20 lg:self-start">
      {groups(organizationId).map((group, groupIndex) => (
        <div key={group.heading} className={groupIndex > 0 ? 'mt-4 lg:mt-6' : undefined}>
          <p className="mb-2 hidden px-3 text-xs font-medium uppercase tracking-wide text-subtle lg:block">
            {group.heading}
          </p>
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {group.entries.map((entry) => {
              const current = activePath === entry.href;
              return (
                <li key={entry.label} className="shrink-0">
                  <Link
                    href={entry.href}
                    aria-current={current ? 'page' : undefined}
                    className={cx(
                      FOCUS_RING,
                      'block rounded px-3 py-2 text-sm',
                      current
                        ? 'bg-foreground font-medium text-background'
                        : 'text-muted hover:bg-black/5 dark:hover:bg-white/10',
                    )}
                  >
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
