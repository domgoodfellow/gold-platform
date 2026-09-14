'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';

/**
 * Scopes, never flattened into one list (product architecture decision, 2026; regrouped in the
 * UI architecture correction that split Branding from Payments and Work from Schedule):
 *
 * - PERSONAL belongs to the signed-in identity, not this organization — Account leaves this
 *   route tree entirely (`/account`), the same way `ContextSwitcher` owns cross-business
 *   navigation rather than this component or `AccountMenu`.
 * - BUSINESS is this organization's durable identity — who it is, what it looks like, who's in it.
 * - OPERATIONS is how work and time are shaped, apart from doing either.
 * - DATA & AUTOMATION is what this organization has added to the kernel, and what it has taught
 *   the platform to do by itself.
 * - CHANNELS & CONNECTIONS is how this organization is reached, and what it has wired up.
 * - COMMERCE is the BUSINESS → CUSTOMER plane — what this organization sells and how it collects.
 * - PRODUCT is the GOLD → ORGANIZATION plane — what this organization has switched on and bought
 *   from GOLD, the opposite money direction from Commerce and never presented as its sibling
 *   (`domain-model.md`'s two-planes table, made literal here).
 *
 * Every entry is a route of its own — no anchor into a page listed elsewhere under a second
 * label. Integrations stays out of this list entirely: it is a main-sidebar workspace (real
 * connections, imports, import runs to operate), not a settings destination, the same line
 * `lib/navigation.ts` already draws by leaving it in `AREAS` with a permanent sidebar row.
 */
type Entry = { label: string; segment: string };

function groups(organizationId: string): { heading: string; entries: { label: string; href: string }[] }[] {
  const root = `/organizations/${organizationId}/settings`;
  const at = (entries: Entry[]) =>
    entries.map((entry) => ({ label: entry.label, href: `${root}/${entry.segment}` }));

  return [
    {
      heading: 'Personal',
      entries: [{ label: 'Account', href: '/account' }],
    },
    {
      heading: 'Business',
      entries: at([
        { label: 'General', segment: 'general' },
        { label: 'Branding & public presence', segment: 'branding' },
        { label: 'People & access', segment: 'people' },
      ]),
    },
    {
      heading: 'Operations',
      entries: at([
        { label: 'Work', segment: 'work' },
        { label: 'Schedule', segment: 'schedule' },
      ]),
    },
    {
      heading: 'Data & automation',
      entries: at([{ label: 'Custom fields & automation', segment: 'data-automation' }]),
    },
    {
      heading: 'Channels & connections',
      entries: at([
        { label: 'Website', segment: 'website' },
        { label: 'Connections', segment: 'connections' },
      ]),
    },
    {
      heading: 'Commerce',
      entries: at([{ label: 'Business commerce', segment: 'commerce' }]),
    },
    {
      heading: 'Product',
      entries: at([
        { label: 'Features', segment: 'features' },
        { label: 'Plan & usage', segment: 'plan' },
      ]),
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
