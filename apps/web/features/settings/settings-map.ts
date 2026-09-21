import { areaEntitled, areaVisibleTo, AREAS, type Area } from '@/lib/navigation';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The configuration map: every place a business is configured, grouped by the concern it answers
 * rather than by the table behind it. One list, so the Settings page renders it and a test reads
 * it, and so anything that later needs to point at "where is X configured" (guided setup, the
 * Agent) targets a `key` here instead of a hand-typed URL.
 *
 * An entry that belongs to a workspace or module names it in `area`, and is then offered only when
 * that area is entitled and relevant to the caller — the same two predicates the sidebar uses, so
 * the map can never offer a door the sidebar would have hidden. Kernel entries name no area.
 */
export type SettingsEntry = {
  key: string;
  title: string;
  description: string;
  /** Path under `/organizations/{id}` — a route that exists, checked by `settings-map.test.ts`. */
  path: string;
  /** The area whose module/capability gate decides whether this entry is offered. */
  area?: string;
};

export type SettingsSection = {
  key: string;
  title: string;
  entries: readonly SettingsEntry[];
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: 'business',
    title: 'Business',
    entries: [
      {
        key: 'general',
        title: 'General',
        description: 'Business name, public address, timezone, currency, and the buffer between jobs.',
        path: 'settings/general',
      },
    ],
  },
  {
    key: 'work',
    title: 'Work & scheduling',
    entries: [
      {
        key: 'work-configuration',
        title: 'Kinds of work',
        description: 'The kinds of work this business does, their stages, and the checklists that come with them.',
        path: 'work/configuration',
      },
      {
        key: 'schedule-configuration',
        title: 'Working hours',
        description: 'When this business works, and how long a slot needs to be.',
        path: 'schedule/configuration',
      },
    ],
  },
  {
    key: 'pricing',
    title: 'Services & pricing',
    entries: [
      {
        key: 'pricing',
        title: 'Pricing',
        description: 'The price book, quote and invoice wording, and how this business gets paid.',
        path: 'pricing',
        area: 'pricing',
      },
    ],
  },
  {
    key: 'data',
    title: 'Customers & data',
    entries: [
      {
        key: 'custom-fields',
        title: 'Custom fields',
        description: 'The extra details this business records about its customers, jobs and places.',
        path: 'fields',
        area: 'fields',
      },
      {
        key: 'call-setup',
        title: 'Calls and sales stages',
        description: 'The words this business uses for how a call went, and the stages a relationship moves through.',
        path: 'calls#setup',
        area: 'calls',
      },
    ],
  },
  {
    key: 'people',
    title: 'People & access',
    entries: [
      {
        key: 'team',
        title: 'Team',
        description: 'Who works here, and what each role is allowed to do.',
        path: 'roles',
        area: 'roles',
      },
    ],
  },
  {
    key: 'brand',
    title: 'Brand & public presence',
    entries: [
      {
        key: 'branding',
        title: 'Branding',
        description: 'Logo, colours, and the public booking page.',
        path: 'settings/branding',
      },
      {
        key: 'website',
        title: 'Website',
        description: 'Homepage publishing and the public communication profile.',
        path: 'settings/website',
      },
    ],
  },
  {
    key: 'connections',
    title: 'Connections',
    entries: [
      {
        key: 'communications',
        title: 'Phone and email',
        description: 'The phone numbers and email address this business sends from.',
        path: 'settings/communications',
      },
      {
        key: 'integrations',
        title: 'Apps and files',
        description: 'The outside apps this business connects, and the data it brings in.',
        path: 'integrations',
        area: 'integrations',
      },
    ],
  },
  {
    key: 'products',
    title: 'Products & features',
    entries: [
      {
        key: 'features',
        title: 'Features',
        description: 'What this business has switched on, and what each one still needs.',
        path: 'settings/features',
      },
    ],
  },
  {
    key: 'plan',
    title: 'Plan & usage',
    entries: [
      {
        key: 'plan',
        title: 'Plan & usage',
        description: 'The current plan, what it includes, usage, and commercial status.',
        path: 'settings/plan',
      },
    ],
  },
  {
    key: 'setup',
    title: 'Setup & launch',
    entries: [
      {
        key: 'setup',
        title: 'Setup',
        // The page replaces this with a sentence that follows the lifecycle; kept so the entry is complete.
        description: 'What setup covers, and what is finished.',
        path: 'setup',
        area: 'setup',
      },
    ],
  },
];

type Gate = {
  enabledModules: ReadonlySet<string>;
  featureAvailability: ReadonlySet<string>;
  capabilities: ReadonlySet<Capability>;
};

/** Whether an entry is offered — the sidebar's own two predicates, so the map cannot disagree with it. */
export function entryOffered(entry: SettingsEntry, gate: Gate): boolean {
  if (!entry.area) return true;
  const area: Area | undefined = AREAS.find((candidate) => candidate.segment === entry.area);
  if (!area) return false;
  return (
    areaEntitled(area, gate.enabledModules, gate.featureAvailability) &&
    areaVisibleTo(area, gate.capabilities)
  );
}

/** The sections with only the offered entries, dropping a section left with none. */
export function offeredSections(gate: Gate): SettingsSection[] {
  return SETTINGS_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => entryOffered(entry, gate)),
  })).filter((section) => section.entries.length > 0);
}
