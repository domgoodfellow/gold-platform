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
  const target = configTarget(key);
  if (target.scope !== 'organization') throw new Error(`${key} belongs to Settings ${target.scope}.`);
  return { key, title, description, path: target.path };
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: 'business',
    title: 'General',
    entries: [
      entry('general', 'General', 'Business name, time zone, and currency.'),
    ],
  },
  {
    key: 'work',
    title: 'Work & scheduling',
    entries: [
      entry('work-configuration', 'Kinds of work', 'The kinds of work this business does, their stages, and the checklists that come with them.'),
      entry('schedule-configuration', 'Working hours', 'Opening hours and the default buffer after scheduled work.'),
      entry('resources', 'Resources', 'People, vehicles, equipment and rooms available for scheduled work.'),
      entry('locations', 'Locations', 'Places where this business performs work.'),
    ],
  },
  {
    key: 'pricing',
    title: 'Pricing',
    entries: [
      entry('pricing', 'Pricing', 'The price book, quote and invoice wording, and how this business gets paid.'),
    ],
  },
  {
    key: 'data',
    title: 'Customer data',
    entries: [
      entry('custom-fields', 'Custom fields', 'The extra details this business records about its customers, jobs and places.'),
      entry('sales-stages', 'Relationship stages', 'The stages a customer relationship moves through, in order.'),
      entry('opportunity-stages', 'Opportunity stages', 'The stages potential business moves through, classified as Open, Won or Lost.'),
    ],
  },
  {
    key: 'brand',
    title: 'Brand & public presence',
    entries: [
      entry('branding', 'Branding', 'Logo, brand colour and lettering, with a preview.'),
      entry('public-profile', 'Public profile', 'The name, tagline, description and contact details customers see.'),
      entry('domains', 'Domains', 'The public booking address, this business’s GildOps address, and any domain it owns and has connected.'),
      entry('website', 'Website', 'Author, review and publish this business’s public website in Studio.'),
    ],
  },
  {
    key: 'connections',
    title: 'Communications configuration',
    entries: [
      entry('communications', 'Phone and messaging', 'The phone numbers this business has, and how its website answers a visitor.'),
      entry('call-setup', 'Call setup', 'The words this business uses for how a call went, routing, and caller identity.'),
      entry('email', 'Email', 'The domain this business sends email from, and what it still needs to be verified.'),
    ],
  },
  {
    key: 'ai-automations',
    title: 'AI & Automations',
    entries: [
      entry('ai-agents', 'Agent deployments', 'Configure this business’s agents and their deployment state.'),
      entry('automation-rules', 'Automation rules', 'Configure triggers, conditions and actions through Automations.'),
    ],
  },
  {
    key: 'products',
    title: 'Features',
    entries: [
      entry('features', 'Features', 'What this business has switched on, and what each one still needs.'),
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
