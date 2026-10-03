import { configTarget, configTargetOffered, type ConfigGate } from '@/lib/navigation';

/**
 * The configuration map: every place a business is configured, grouped by the concern it answers
 * rather than by the table behind it. One list, so the Settings page renders it and a test reads
 * it, and so anything that later needs to point at "where is X configured" (guided setup, the
 * Agent) targets a `key` here instead of a hand-typed URL.
 *
 * **An entry carries only words.** Where it goes and who may be offered it are a `ConfigTarget`
 * (`lib/navigation.ts`), found by the entry's `key`: its path, the entitlement it needs and the
 * *configuration* permission it needs. Configuring is not operating — a role may configure call
 * outcomes without being allowed to place a call — so the map never inherits a workspace's own
 * `relevantCapabilities`. The Business navigation reads the same targets, so the two cannot
 * offer different doors.
 */
export type SettingsEntry = {
  /** Also the `ConfigTarget` key. */
  key: string;
  title: string;
  description: string;
  /** Path under `/organizations/{id}` — read from the target, never restated here. */
  path: string;
};

export type SettingsSection = {
  key: string;
  title: string;
  entries: readonly SettingsEntry[];
};

function entry(key: string, title: string, description: string): SettingsEntry {
  return { key, title, description, path: configTarget(key).path };
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: 'business',
    title: 'Business',
    entries: [
      entry('general', 'General', 'Business name, public address, timezone, currency, and the buffer between jobs.'),
    ],
  },
  {
    key: 'work',
    title: 'Work & scheduling',
    entries: [
      entry('work-configuration', 'Kinds of work', 'The kinds of work this business does, their stages, and the checklists that come with them.'),
      entry('schedule-configuration', 'Working hours', 'When this business works, and how long a slot needs to be.'),
    ],
  },
  {
    key: 'pricing',
    title: 'Services & pricing',
    entries: [
      entry('pricing', 'Pricing', 'The price book, quote and invoice wording, and how this business gets paid.'),
    ],
  },
  {
    key: 'data',
    title: 'Customers & data',
    entries: [
      entry('custom-fields', 'Custom fields', 'The extra details this business records about its customers, jobs and places.'),
      entry('sales-stages', 'Sales stages', 'The stages a relationship moves through, in order.'),
    ],
  },
  {
    key: 'people',
    title: 'People & access',
    entries: [
      entry('team', 'Team', 'Who works here, and what each role is allowed to do.'),
    ],
  },
  {
    key: 'brand',
    title: 'Brand & public presence',
    entries: [
      entry('branding', 'Branding', 'Logo, colours, and the public booking page.'),
      entry('domains', 'Domains', 'This business’s GildOps address, and any domain it owns and has connected.'),
    ],
  },
  {
    key: 'connections',
    title: 'Connections',
    entries: [
      entry('communications', 'Phone and messaging', 'The phone numbers this business has, and how its website answers a visitor.'),
      entry('call-setup', 'Call setup', 'The words this business uses for how a call went, routing, and caller identity.'),
      entry('email', 'Email', 'The domain this business sends email from, and what it still needs to be verified.'),
      entry('integrations', 'Apps and files', 'The outside apps this business connects, and the data it brings in.'),
    ],
  },
  {
    key: 'products',
    title: 'Products & features',
    entries: [
      entry('features', 'Features', 'What this business has switched on, and what each one still needs.'),
    ],
  },
  {
    key: 'plan',
    title: 'Plan & usage',
    entries: [
      entry('plan', 'Plan & usage', 'The current plan, what it includes, usage, and commercial status.'),
    ],
  },
];

/** Whether an entry is offered: the business is entitled to it and the member may configure it. */
export function entryOffered(candidate: SettingsEntry, gate: ConfigGate): boolean {
  return configTargetOffered(configTarget(candidate.key), gate);
}

/** The sections with only the offered entries, dropping a section left with none. */
export function offeredSections(gate: ConfigGate): SettingsSection[] {
  return SETTINGS_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((candidate) => entryOffered(candidate, gate)),
  })).filter((section) => section.entries.length > 0);
}
