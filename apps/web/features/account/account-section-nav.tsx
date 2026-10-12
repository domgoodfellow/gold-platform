'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';
import { PERSONAL_SECTIONS, personalSettingsHref } from '@/lib/route/personal-settings';

/**
 * Account's own local nav — Profile, Security & sign-in — rendered beneath each page's own
 * `PageHeader` (breadcrumb + title), the same position every other Settings scope's local nav
 * sits in (Access's Members/Invitations/Roles `ViewNav`, Connections' `IntegrationsNav`).
 */
export function AccountSectionNav({ organizationId }: { organizationId: string | null }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Account" className="mb-6 flex gap-1 overflow-x-auto border-b border-border [&_a]:shrink-0 [&_a]:whitespace-nowrap">
      {PERSONAL_SECTIONS.map((section) => {
        const current = pathname === section.path;
        return (
          <Link
            key={section.key}
            href={personalSettingsHref(section.key, organizationId)}
            aria-current={current ? 'page' : undefined}
            className={cx(
              FOCUS_RING,
              '-mb-px border-b-2 px-3 py-2 text-sm',
              current ? 'border-foreground font-medium' : 'border-transparent text-muted hover:text-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
