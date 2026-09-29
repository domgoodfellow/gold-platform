'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';
import { PERSONAL_SECTIONS, personalSettingsHref } from '@/lib/route/personal-settings';

/**
 * Account's own second-level nav — Profile, Security & sign-in — one level in from the Settings
 * scope tab bar (`SettingsScopeNav`) every scope shares. The scope line lives in that shared bar;
 * this draws only the sections beneath it, so the two are never said twice.
 */
export function AccountSectionNav({ organizationId }: { organizationId: string | null }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Account" className="mb-6 flex gap-1 border-b border-border">
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
