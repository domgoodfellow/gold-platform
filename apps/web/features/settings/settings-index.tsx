import Link from 'next/link';
import { Card } from '@/components/containers/card';
import { SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
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
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
            {section.entries.map((entry) => (
              <Card
                key={entry.key}
                as="div"
                className="relative transition-colors hover:bg-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent-text"
              >
                <SectionHeading>
                  <Link
                    href={`/organizations/${organizationId}/${entry.path}`}
                    className={`${FOCUS_RING} rounded after:absolute after:inset-0`}
                  >
                    {entry.title}
                  </Link>
                </SectionHeading>
                <Hint className="mt-1">{describe?.(entry.key) ?? entry.description}</Hint>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
