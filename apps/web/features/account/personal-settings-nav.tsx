'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx, FOCUS_RING } from '@/components/class-names';
import { PERSONAL_SECTIONS, personalSettingsHref } from '@/lib/route/personal-settings';

/**
 * The scope line and section switch at the head of every Personal settings page. Personal settings
 * is drawn inside whichever shell the person is already in, so the *page* says whose it is — one
 * line of words and a pair of links — rather than a second application saying it for it.
 * `business` is the business whose shell this is, when there is one; it only carries the way back
 * to that business's own Settings.
 */
export function PersonalSettingsNav({
  organizationId,
  business,
}: {
  organizationId: string | null;
  business: { name: string; settingsHref: string } | null;
}) {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex flex-col gap-3">
      <p className="text-sm text-muted">
        Personal settings — yours, and the same in every business.
        {business ? (
          <>
            {' '}
            <Link href={business.settingsHref} className="underline underline-offset-4">
              {business.name} settings
            </Link>{' '}
            are separate.
          </>
        ) : null}
      </p>
      <nav aria-label="Personal settings" className="flex gap-1 border-b border-border">
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
    </div>
  );
}
