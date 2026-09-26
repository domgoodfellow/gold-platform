import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { DividedList } from '@/components/containers/section';
import { FOCUS_RING } from '@/components/class-names';
import { PERSONAL_SECTIONS, personalSettingsHref } from '@/lib/route/personal-settings';

/**
 * The person's own settings, offered beside the business's. They are listed here because Settings
 * is where somebody looks for configuration; they stay the person's — the links go to
 * `/settings/account`, which reads the signed-in user and nothing of this business.
 */
export function PersonalSettingsEntries({ organizationId }: { organizationId: string }) {
  return (
    <section aria-labelledby="settings-personal" className="mb-8">
      <h2 id="settings-personal" className="mb-3 text-sm font-medium uppercase tracking-wide text-subtle">
        Personal
      </h2>
      <DividedList className="border-y border-border">
        {PERSONAL_SECTIONS.map((section) => (
          <li key={section.key} className="relative flex items-center gap-4 py-3 transition-colors hover:bg-hover">
            <div className="min-w-0 flex-1">
              <Link
                href={personalSettingsHref(section.key, organizationId)}
                className={`${FOCUS_RING} rounded font-medium after:absolute after:inset-0`}
              >
                {section.label}
              </Link>
              <p className="mt-0.5 text-sm text-muted">{section.description} Yours in every business.</p>
            </div>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
          </li>
        ))}
      </DividedList>
    </section>
  );
}
