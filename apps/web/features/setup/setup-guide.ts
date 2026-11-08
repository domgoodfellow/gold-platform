import { SETTINGS_SECTIONS, entryOffered, type SettingsEntry } from '@/features/settings/settings-map';
import { configTarget, configTargetOffered, type ConfigGate } from '@/lib/navigation';
import type { SetupArea, SetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { configurationOwnerPath } from '@/lib/route/setup-context';

export type SetupStep = {
  key: string;
  label: string;
  description: string;
  destinations: SettingsEntry[];
  areas: SetupArea[];
};

const GROUPS = [
  { key: 'business', label: 'Business information', description: 'Confirm who the business is, where it is, and the time zone and currency it runs on.', targets: ['general'] },
  { key: 'operations', label: 'Operations', description: 'The work you do, and scheduling when you need it.', targets: ['work-configuration', 'schedule-configuration'] },
  { key: 'people', label: 'People and resources', description: 'Your team, their permissions, and the people and things you schedule.', targets: ['team', 'resources', 'locations'] },
  { key: 'customers', label: 'Customers and data', description: 'Choose relationship stages, opportunity stages and the information you collect.', targets: ['sales-stages', 'opportunity-stages', 'custom-fields'] },
  { key: 'communications', label: 'Communications', description: 'Calling, numbers, messaging and the email addresses you send from.', targets: ['phone-numbers', 'communications', 'call-setup', 'email', 'integrations'] },
  { key: 'finance', label: 'Finance', description: 'Set up the prices this business charges its customers and how customers pay. Your GildOps subscription stays separate.', targets: ['price-book', 'payments'] },
  { key: 'presence', label: 'Public presence', description: 'Review branding, domain verification and your published website.', targets: ['branding', 'public-profile', 'domains', 'website'] },
  { key: 'ai', label: 'AI and Automations', description: 'Agents and automation rules.', targets: ['ai-agents', 'automation-rules'] },
] as const;

/** Group canonical destinations and observed readiness; navigation never creates completion state. */
export function setupGuide(organizationId: string, overview: SetupOverview, gate: ConfigGate): SetupStep[] {
  const entries = SETTINGS_SECTIONS.flatMap((section) => section.entries);
  const extras: SettingsEntry[] = [
    { key: 'phone-numbers', title: 'Numbers & assignments', description: 'The numbers this business has, and whether each is ready.', path: configTarget('phone-numbers').path },
    { key: 'team', title: 'Access', description: 'Members, invitations and roles.', path: configTarget('team').path },
    { key: 'integrations', title: 'Connections', description: 'Customer-owned connected applications.', path: configTarget('integrations').path },
    { key: 'plan', title: 'Plan & usage', description: 'Subscription status and recorded usage.', path: configTarget('plan').path },
  ];
  const byKey = new Map([...entries, ...extras].map((entry) => [entry.key, entry]));
  const assigned = new Set<string>();
  const steps: SetupStep[] = GROUPS.flatMap((group) => {
    const destinations = group.targets.flatMap((key) => {
      const entry = byKey.get(key);
      return entry && (entry.key === 'team' || entry.key === 'integrations'
        ? configTargetOffered(configTarget(entry.key), gate) : entryOffered(entry, gate)) ? [entry] : [];
    });
    const areas = overview.areas.filter((area) => destinations.some((entry) =>
      configurationOwnerPath(area.area.href) === `/organizations/${organizationId}/${entry.path}`));
    areas.forEach((area) => assigned.add(area.key));
    return destinations.length ? [{ key: group.key, label: group.label, description: group.description, destinations, areas }] : [];
  });
  const reviewDestinations = ['features', 'plan'].flatMap((key) => {
    const entry = byKey.get(key);
    return entry && configTargetOffered(configTarget(key), gate) ? [entry] : [];
  });
  steps.push({ key: 'review', label: 'Review and launch', description: 'Review required conditions and launch when the business is ready.', destinations: reviewDestinations, areas: overview.areas.filter((area) => !assigned.has(area.key)) });
  return steps;
}

export function setupStepHref(organizationId: string, key: string): string {
  return `/organizations/${organizationId}/setup?step=${encodeURIComponent(key)}`;
}

export function resumeSetupStep(steps: SetupStep[]): SetupStep {
  return steps.find((step) => step.areas.some((area) => area.state === 'incomplete' && area.importance === 'required'))
    ?? steps.find((step) => step.areas.some((area) => area.state === 'incomplete')) ?? steps[0];
}
