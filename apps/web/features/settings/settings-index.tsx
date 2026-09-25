import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { DividedList } from '@/components/containers/section';
import { FOCUS_RING } from '@/components/class-names';
import type { SettingsSection } from './settings-map';

/**
 * The configuration map as a page body: one labelled group per business concern, each entry one
 * link — its title — stretched over its card, so there is one obvious target and no second control
 * inside something clickable as a whole. `describe` lets the page say something truer than the
 * static description where the sentence depends on state (Setup, whose wording follows the
 * lifecycle).
 */
export function SettingsIndex({
  organizationId,
  sections,
  describe,
}: {
  organizationId: string;
  sections: readonly SettingsSection[];
  describe?: (key: string) => string | undefined;
}) {
  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`settings-${section.key}`}>
          <h2
            id={`settings-${section.key}`}
            className="mb-3 text-sm font-medium uppercase tracking-wide text-subtle"
          >
            {section.title}
          </h2>
          <DividedList className="border-y border-border">
            {section.entries.map((entry) => (
              <li key={entry.key} className="relative flex items-center gap-4 py-3 transition-colors hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/organizations/${organizationId}/${entry.path}`}
                    className={`${FOCUS_RING} rounded font-medium after:absolute after:inset-0`}
                  >
                    {entry.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted">{describe?.(entry.key) ?? entry.description}</p>
                </div>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
              </li>
            ))}
          </DividedList>
        </section>
      ))}
    </div>
  );
}
