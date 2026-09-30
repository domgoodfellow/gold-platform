import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { CollectionView } from '@/components/surfaces/collection-view';
import { DividedList } from '@/components/surfaces/section';
import { FOCUS_RING } from '@/components/class-names';
import type { SettingsEntry, SettingsSection } from './settings-map';

/** Where the reader's List/Grid choice is kept — per browser, never on the server. */
export const SETTINGS_PRESENTATION_KEY = 'gold.settings.presentation';

type Props = {
  organizationId: string;
  sections: readonly SettingsSection[];
  describe?: (key: string) => string | undefined;
};

/**
 * The configuration map as a page body, in two presentations of the same groups: a divided list
 * (the default) and a grid of tiles. Either way each entry is one link — its title — stretched over
 * its whole row or tile, so there is one obvious target and no second control inside something
 * clickable as a whole. `describe` lets the page say something truer than the static description
 * where the sentence depends on state (Setup, whose wording follows the lifecycle).
 */
export function SettingsIndex(props: Props) {
  return (
    <CollectionView
      storageKey={SETTINGS_PRESENTATION_KEY}
      defaultPresentation="list"
      label="Settings layout"
      renderings={{ list: <SettingsList {...props} />, grid: <SettingsGrid {...props} /> }}
    />
  );
}

function entryHref(organizationId: string, entry: SettingsEntry) {
  return `/organizations/${organizationId}/${entry.path}`;
}

function SettingsGroups({
  sections,
  children,
}: {
  sections: readonly SettingsSection[];
  children: (section: SettingsSection) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`settings-${section.key}`}>
          <h2 id={`settings-${section.key}`} className="mb-3 text-sm font-medium uppercase tracking-wide text-subtle">
            {section.title}
          </h2>
          {children(section)}
        </section>
      ))}
    </div>
  );
}

export function SettingsList({ organizationId, sections, describe }: Props) {
  return (
    <SettingsGroups sections={sections}>
      {(section) => (
        <DividedList className="border-y border-border">
          {section.entries.map((entry) => (
            <li key={entry.key} className="relative flex items-center gap-4 py-3 transition-colors hover:bg-hover">
              <div className="min-w-0 flex-1">
                <Link
                  href={entryHref(organizationId, entry)}
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
      )}
    </SettingsGroups>
  );
}

export function SettingsGrid({ organizationId, sections, describe }: Props) {
  return (
    <SettingsGroups sections={sections}>
      {(section) => (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {section.entries.map((entry) => (
            <li
              key={entry.key}
              className="relative rounded-lg border border-border p-4 transition-colors hover:bg-hover"
            >
              <Link
                href={entryHref(organizationId, entry)}
                className={`${FOCUS_RING} rounded font-medium after:absolute after:inset-0 after:rounded-lg`}
              >
                {entry.title}
              </Link>
              <p className="mt-1 text-sm text-muted">{describe?.(entry.key) ?? entry.description}</p>
            </li>
          ))}
        </ul>
      )}
    </SettingsGroups>
  );
}
