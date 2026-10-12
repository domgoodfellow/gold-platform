import { configTarget, configTargetOffered, WORKSPACES, areaHref, AREAS, type ConfigGate } from '@/lib/navigation';
import type { NavItem, ShellSection } from '@/lib/shell';
import { PERSONAL_SECTIONS, personalSettingsHref } from '@/lib/route/personal-settings';

/**
 * Settings as a context of the one shell: the sidebar swaps its workspaces for these destinations
 * while a person is inside Settings, rather than mounting a second navigation. Pure and shared, so
 * the sidebar, the Settings landing redirect and the tests read one list.
 *
 * Only cross-workspace administration lives here. Configuration that controls how one workspace does
 * its work (price book, call routing, stages…) stays in that workspace and is found through search
 * (`settingsSearchItems`), which points at the same `CONFIG_TARGETS` the workspaces use.
 */

const ORGANIZATION: readonly { key: string; label: string; target: string }[] = [
  { key: 'settings-general', label: 'General', target: 'general' },
  { key: 'settings-branding', label: 'Branding', target: 'branding' },
  { key: 'settings-domains', label: 'Domains', target: 'domains' },
  { key: 'settings-features', label: 'Features', target: 'features' },
];

function item(organizationId: string, spec: { key: string; label: string; target: string }, section: NavItem['section'], gate: ConfigGate): NavItem | null {
  const target = configTarget(spec.target);
  if (!configTargetOffered(target, gate)) return null;
  return { key: spec.key, label: spec.label, href: `/organizations/${organizationId}/${target.path}`, section };
}

export function projectSettingsNav(organizationId: string, gate: ConfigGate): ShellSection[] {
  const personal: NavItem[] = PERSONAL_SECTIONS.map(spec => ({
    key: `settings-${spec.key}`, label: spec.label, href: personalSettingsHref(spec.key, organizationId),
    section: 'settings-personal', exact: spec.key === 'profile', activeHrefs: [spec.path],
  }));
  const organization = ORGANIZATION.map((spec) => item(organizationId, spec, 'settings-organization', gate)).filter((entry): entry is NavItem => entry !== null);
  const connections = configTargetOffered(configTarget('integrations'), gate) || configTargetOffered(configTarget('secrets'), gate)
    ? [{ key: 'settings-connections', label: 'Connections', href: `/organizations/${organizationId}/${configTarget('integrations').path}`, section: 'settings-administration' as const }]
    : [];
  const administration = [
    item(organizationId, { key: 'settings-access', label: 'Team & access', target: 'team' }, 'settings-administration', gate),
    ...connections,
    item(organizationId, { key: 'settings-plan', label: 'Plan & usage', target: 'plan' }, 'settings-administration', gate),
  ].filter((entry): entry is NavItem => entry !== null);

  return [
    { key: 'settings-personal', label: 'Personal', items: personal },
    { key: 'settings-organization', label: 'Organization', items: organization },
    { key: 'settings-administration', label: 'Administration', items: administration },
  ].filter((section) => section.items.length > 0) as ShellSection[];
}

/** The first destination a person may use — where bare `/settings` lands. */
export function defaultSettingsHref(sections: readonly ShellSection[]): string {
  return sections.find((section) => section.key !== 'settings-personal')?.items[0]?.href ?? sections[0].items[0].href;
}

/** Path segments under `/organizations/{id}/settings/` that belong to the Settings context. Workspace-owned configuration is deliberately absent. */
const SETTINGS_SEGMENTS = ['general', 'branding', 'domains', 'features', 'access', 'connections', 'secrets', 'plan', 'organization'];

export function inSettingsContext(pathname: string, organizationId: string): boolean {
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, '');
  if (path === '/settings/account' || path.startsWith('/settings/account/')) return true;
  const root = `/organizations/${organizationId}/settings`;
  if (path === root) return true;
  if (!path.startsWith(`${root}/`)) return false;
  return SETTINGS_SEGMENTS.includes(path.slice(root.length + 1).split('/')[0]);
}

export type SettingsSearchItem = { key: string; label: string; description: string; href: string; /** Extra words a person might search by, never shown. */ keywords?: string };

/** Settings destinations plus the workspace-owned configuration a person might be looking for. */
export function settingsSearchItems(organizationId: string, sections: readonly ShellSection[], configuration: readonly { key: string; title: string; description: string; path: string }[]): SettingsSearchItem[] {
  const destinations = sections.flatMap((section) => section.items.map((entry) => ({
    key: entry.key,
    label: entry.label,
    description: section.label ?? '',
    href: entry.href,
    keywords: configuration.find((candidate) => entry.href.endsWith(`/${candidate.path}`))?.description,
  })));
  const owned = configuration
    .filter((entry) => !destinations.some((destination) => destination.href.endsWith(`/${entry.path}`)))
    .map((entry) => {
      const workspace = configTarget(entry.key).workspace;
      const label = workspace ? WORKSPACES.find((candidate) => candidate.key === workspace)?.label : undefined;
      return { key: `config-${entry.key}`, label: entry.title, description: label ? `In ${label}` : entry.description, href: `/organizations/${organizationId}/${entry.path}` };
    });
  return [...destinations, ...owned];
}

/** Breadcrumb ancestors for a configuration page that belongs to a workspace: that workspace's Home. */
export function workspaceConfigCrumbs(organizationId: string, targetKey: string): { label: string; href: string }[] {
  const workspaceKey = configTarget(targetKey).workspace;
  const workspace = WORKSPACES.find((candidate) => candidate.key === workspaceKey);
  if (!workspace) return [];
  const home = AREAS.find((area) => area.segment === workspace.home);
  return home ? [{ label: workspace.label, href: areaHref(organizationId, home.segment) }] : [];
}
