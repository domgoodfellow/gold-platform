import { organizationIdFromPath } from '@/lib/route/platform-context';
import { settingsScopeHref } from '@/lib/route/settings';
import {
  AREAS,
  CONFIG_TARGETS,
  WORKSPACES,
  areaEntitled,
  areaHref,
  areaRelevantToShape,
  areaVisibleTo,
  configTarget,
  configTargetForHref,
  configTargetOffered,
  workspaceConfigureItems,
  workspaceConfigurationHref,
  workspaceConfigurationOwner,
  workspaceConfigurationTarget,
  type Area,
  type ConfigTarget,
} from '@/lib/navigation';
import {
  ADMINISTRATION_LABEL,
  PLATFORM_GROUPS,
  platformDestinationsFor,
  platformHref,
  platformSubpath,
  type PlatformDestination,
} from '@/lib/platform-navigation';
import type { PlatformCapability } from '@/lib/domain/platform/permissions';
import type { SerializedLocationAccess } from '@/lib/route/page-location';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/** One eligibility projection for all breakpoints. Business Home is the operational cockpit;
 * Work owns concrete execution. Administration is a privileged scope of GildOps' own organization,
 * never a tenant workspace. Visibility is courtesy: each destination continues enforcing its own
 * authority.
 */
export type ShellSectionKey = 'home' | 'library' | 'workspaces' | 'administration' | 'settings-personal' | 'settings-organization' | 'settings-administration';

export type NavItem = {
  /** Unique within a rendered context; also the icon key. Dashboard is shared across workspace contexts. */
  key: string;
  label: string;
  href: string;
  section: ShellSectionKey;
  /** Operable Area addresses that activate this flat workspace row. */
  activeHrefs?: string[];
  /** Eligible operating destinations, rendered only after entering this workspace. */
  destinations?: NavItem[];
  configuration?: NavItem;
  /**
   * Every configuration door this member may open from this workspace, including ones reached from
   * the destination they configure (which draw no Configuration row). Never drawn in the sidebar;
   * a Home's shortcuts read it, so contextual configuration stays one click from Home.
   */
  configureDoors?: NavItem[];
  /**
   * The workspace's registered Calendar destination (`AREAS`, `{home}/calendar`), offered as a shortcut
   * only while its Home is usable and the calendar area is available. Never built from a string.
   */
  calendar?: NavItem;
  /** A staff-only link into Administration, drawn after this workspace's Configuration. */
  administration?: NavItem;
  /**
   * Drawn only once somebody is inside it: everything in it is already linked from their
   * workspaces, so a top-level row would offer nothing new.
   */
  contextOnly?: boolean;
  configurationOnly?: boolean;
  /**
   * The destinations grouped under a navigable parent. A parent is
   * itself a destination (a Platform group opens its first page), so
   * a renderer without room for children — the collapsed rail — can still link to it.
   */
  children?: NavItem[];
  /**
   * A grouping parent with no page of its own (a Configuration without a landing): it expands and
   * collapses its children, and its `href` — an address that only redirects — is never drawn as a link.
   */
  group?: true;
  /** Matches only its own address, not everything beneath it: the Administration overview is the root of a whole tree. */
  exact?: boolean;
  /**
   * A heading that has no page of its own: its `href` is its first page's, so the collapsed rail has
   * somewhere to go, and no renderer lists it a second time as an overview.
   */
  heading?: boolean;
};

export type ShellSection = {
  key: ShellSectionKey;
  /** `null` draws no heading — Home names itself. */
  label: string | null;
  /** Optional linked heading for non-workspace contexts. Workspace identity is plain text. */
  href?: string;
  items: NavItem[];
};

export type ShellInput = {
  organizationId: string;
  /** Legacy module keys the business has active. */
  enabledModules: ReadonlySet<string>;
  /** Canonical Feature keys entitled, active and implemented. */
  featureAvailability: ReadonlySet<string>;
  /** What this member's roles grant here. */
  capabilities: ReadonlySet<Capability>;
  /** `hasSchedulableWork` for this organization — its declared shape of work. Omitted means unknown, which hides nothing. */
  schedulableWork?: boolean;
};

const SECTION_LABELS: Record<ShellSectionKey, string | null> = {
  home: null,
  library: null,
  workspaces: 'Workspaces',
  administration: null,
  'settings-personal': 'Personal',
  'settings-organization': 'Organization',
  'settings-administration': 'Administration',
};

export const SHELL_SECTION_ORDER: readonly ShellSectionKey[] = ['home', 'library', 'workspaces'];

function areaItem(organizationId: string, area: Area, section: ShellSectionKey): NavItem {
  return {
    key: area.segment,
    label: area.label,
    href: areaHref(organizationId, area.segment),
    section,
  };
}

/** Whether `target` configures a destination page of `workspace` itself, and so is reached from that page. */
function configuresOwnDestination(target: ConfigTarget | undefined, workspace: string): boolean {
  return Boolean(target?.destination && AREAS.find((area) => area.segment === target.destination)?.workspace === workspace);
}

/** A workspace page, which also stays selected while somebody edits the configuration behind it. */
function destinationItem(organizationId: string, area: Area): NavItem {
  const editors = CONFIG_TARGETS.filter((target) => target.destination === area.segment).map((target) => `/organizations/${organizationId}/${target.path}`);
  if (area.segment === 'opportunity-pipeline') editors.push(areaHref(organizationId, 'opportunities'));
  return { ...areaItem(organizationId, area, 'workspaces'), ...(editors.length ? { activeHrefs: editors } : {}) };
}

/**
 * Adds Platform Administration to GildOps' own organization shell. The caller has already
 * established that this organization is the operating organization, that the person is a member
 * of it and which platform permissions they hold; nothing here widens that.
 *
 * Every destination is filtered by its own permission and forms one private Administration
 * entry. A group or destination linked from a workspace (Commercial administration from Finance,
 * AI Runtime from AI) also gets a link there when that workspace is in the shell. When every
 * part of Administration is already linked that way — staff who hold only commercial authority —
 * the entry is drawn only once they are inside it, so they are not offered an empty area.
 */
export function withAdministration(sections: readonly ShellSection[], organizationId: string, permissions: ReadonlySet<PlatformCapability>): ShellSection[] {
  const destinations = platformDestinationsFor(permissions);
  if (destinations.length === 0) return [...sections];

  const workspaceRows = new Set(sections.flatMap((section) => section.items.map((item) => item.key)));
  const links = new Map<string, NavItem>();
  const linked = new Set<string>();
  const link = (workspace: string | undefined, item: NavItem) => {
    const row = workspace ? `workspace-${workspace}` : null;
    if (!row || !workspaceRows.has(row) || links.has(row)) return;
    links.set(row, { key: item.key.replace(/^platform-(group-)?/, 'platform-link-'), label: item.label, href: item.href, section: 'workspaces' });
    linked.add(item.key);
  };
  const page = (destination: PlatformDestination): NavItem => ({
    key: `platform-${destination.key}`,
    label: destination.label,
    href: platformHref(organizationId, destination.path),
    section: 'administration',
    ...(destination.path === '' ? { exact: true } : {}),
  });

  const entry: NavItem[] = [];
  for (const destination of destinations) {
    link(destination.linkedFrom, page(destination));
    if (!destination.under) {
      entry.push(page(destination));
      continue;
    }
    if (entry.some((item) => item.key === `platform-group-${destination.under}`)) continue;
    const group = PLATFORM_GROUPS.find((candidate) => candidate.key === destination.under)!;
    const pages = destinations.filter((candidate) => candidate.under === group.key).map(page);
    const node: NavItem = { key: `platform-group-${group.key}`, label: group.label, href: pages[0].href, section: 'administration', heading: true, children: pages };
    entry.push(node);
    link(group.linkedFrom, node);
  }

  const projected = sections.map((section) => ({
    ...section,
    items: section.items.map((item) => (links.has(item.key) ? { ...item, administration: links.get(item.key) } : item)),
  }));
  const administration: NavItem = { key: 'administration', label: ADMINISTRATION_LABEL, href: entry[0].href, section: 'administration', destinations: entry };
  if (entry.every((item) => linked.has(item.key))) administration.contextOnly = true;
  return [...projected, { key: 'administration', label: SECTION_LABELS.administration, items: [administration] }];
}

/** The sections drawn before anybody has entered a context: entries drawn only from inside are left out. */
export function topLevelSections(sections: readonly ShellSection[]): ShellSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.contextOnly) }))
    .filter((section) => section.items.length > 0);
}

export type HeaderUtility = { key: 'team' | 'connections'; label: string; href: string };

/** Organization utility offers use the same configuration eligibility as Settings. */
export function projectHeaderUtilities(input: ShellInput): HeaderUtility[] {
  const gate = input;
  const team = configTargetOffered(configTarget('team'), gate);
  const connections = configTargetOffered(configTarget('integrations'), gate) || configTargetOffered(configTarget('secrets'), gate);
  return [
    ...(team ? [{ key: 'team' as const, label: 'Team', href: settingsScopeHref('access', input.organizationId) }] : []),
    ...(connections ? [{ key: 'connections' as const, label: 'Connections', href: settingsScopeHref('connections', input.organizationId) }] : []),
  ];
}

export function projectShell(input: ShellInput): ShellSection[] {
  const { organizationId, enabledModules, featureAvailability, capabilities, schedulableWork } = input;

  const eligible = (area: Area) =>
    areaEntitled(area, enabledModules, featureAvailability) &&
    areaVisibleTo(area, capabilities) &&
    areaRelevantToShape(area, schedulableWork);
  const operable = (area: Area) => area.sidebar !== false && eligible(area);

  const inGroup = (group: Area['group']) => AREAS.filter((area) => area.group === group && operable(area));

  // A real, operable Home earns one flat row; registered workspaces without Homes stay absent.
  const workspaceItems = (): NavItem[] => WORKSPACES.flatMap((workspace) => {
    const areas = AREAS.filter((area) => area.workspace === workspace.key && operable(area));
    const home = workspace.home ? areas.find((area) => area.segment === workspace.home) : undefined;
    const concerns = workspaceConfigureItems(organizationId, workspace.key, { enabledModules, featureAvailability, capabilities, schedulableWork });
    // A door that edits one of this workspace's destinations is that destination's, not a branch of
    // its own. Another workspace linking to the same editor (Communications' Business hours) keeps it.
    const branch = concerns.filter(concern => !configuresOwnDestination(configTargetForHref(concern.href), workspace.key));
    if (!home && branch.length === 0) return [];
    // `{home}/configuration` only redirects; it is matched as active but never drawn as a link.
    const configurationHref = workspaceConfigurationHref(organizationId, workspace.key);
    const ownPages = branch.filter(concern => {
      const target = configTargetForHref(concern.href);
      return target?.workspace === workspace.key && !target.treatment;
    }).map(concern => concern.href.split('#')[0]);
    // One page is a direct link; several are a group that expands and collapses, never a page that lists them again.
    const configuration: NavItem | undefined = branch.length === 1
      ? { key: 'workspace-configuration', label: 'Configuration', href: branch[0].href, activeHrefs: [configurationHref, ...ownPages], section: 'workspaces' }
      : branch.length ? {
        key: 'workspace-configuration', label: 'Configuration', href: configurationHref, group: true,
        activeHrefs: ownPages,
        section: 'workspaces',
        children: branch.map(concern => ({ ...concern, section: 'workspaces' as const })),
      } : undefined;
    // The registered calendar beneath this workspace's Home, only while that Home is usable.
    const calendarRoute = home ? `${home.route ?? home.segment}/calendar` : null;
    const calendarArea = calendarRoute ? AREAS.find((area) => area.workspace === workspace.key && (area.route ?? area.segment) === calendarRoute) : undefined;
    const calendar: NavItem | undefined = calendarArea && eligible(calendarArea)
      ? { key: calendarArea.segment, label: calendarArea.label, href: areaHref(organizationId, calendarArea.segment), section: 'workspaces' }
      : undefined;
    return [{
      key: `workspace-${workspace.key}`,
      label: workspace.label,
      href: home ? areaHref(organizationId, home.segment) : branch[0].href,
      section: 'workspaces',
      activeHrefs: [...AREAS.filter((area) => area.workspace === workspace.key && area.group === 'workspaces' && eligible(area)).map((area) => areaHref(organizationId, area.segment)), ...(configuration ? [configurationHref, ...(configuration.activeHrefs ?? [])] : [])],
      configuration,
      ...(concerns.length ? { configureDoors: concerns.map(concern => ({ ...concern, section: 'workspaces' as const })) } : {}),
      ...(calendar ? { calendar } : {}),
      configurationOnly: !home,
      destinations: [
        ...(home ? [{ ...destinationItem(organizationId, home), key: 'workspace-dashboard', label: 'Dashboard', exact: true }] : []),
        ...areas.filter((area) => area.segment !== home?.segment).map((area) => destinationItem(organizationId, area)),
      ],
    }];
  });

  const sections: ShellSection[] = [
    { key: 'home', label: SECTION_LABELS.home, items: inGroup('home').map((area) => areaItem(organizationId, area, 'home')) },
    { key: 'library', label: SECTION_LABELS.library, items: inGroup('library').map((area) => areaItem(organizationId, area, 'library')) },
    { key: 'workspaces', label: SECTION_LABELS.workspaces, items: workspaceItems() },
  ];

  // A section with nothing in it is not drawn: naming a part of the product that is not there for
  // this person is worse than the gap.
  return sections.filter((section) => section.items.length > 0);
}

type ContextNavigation = { workspace: NavItem; sections: ShellSection[]; backHref: string };

function workspaceContext(workspace: NavItem, organizationId: string): ContextNavigation {
  return {
    workspace,
    backHref: areaHref(organizationId, 'home'),
    // Identity is separate from the explicit, permission-filtered Dashboard destination (ADR-049).
    sections: [{ key: 'workspaces', label: workspace.label, items: [
      ...(workspace.destinations ?? []),
      ...(workspace.configuration ? [workspace.configuration] : []),
      ...(workspace.administration ? [workspace.administration] : []),
    ] }],
  };
}

/**
 * The Administration context for an address beneath it. A workspace that links in owns nothing
 * here. Null when the projection offers this person nothing at that address — the page then
 * refuses on its own.
 */
function administrationNavigation(sections: readonly ShellSection[], organizationId: string, path: string): ContextNavigation | null {
  const entry = projectedItems(sections).find((item) => item.key === 'administration');
  if (!entry?.destinations || activeItemKey([{ key: 'administration', label: null, items: entry.destinations }], path) === null) return null;
  return {
    workspace: entry,
    backHref: areaHref(organizationId, 'home'),
    sections: [{ key: 'administration', label: entry.label, items: entry.destinations }],
  };
}

/** Resolve ownership before visibility, so an unavailable nested Area cannot fall back to its Home. */
export function workspaceNavigation(sections: readonly ShellSection[], pathname: string): ContextNavigation | null {
  const organizationId = organizationIdFromPath(pathname) ?? (platformSubpath(pathname) !== null ? organizationIdFromPath(shellHomeItem(sections)?.href ?? '') : null);
  if (!organizationId) return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, '');
  if (platformSubpath(path) !== null) return administrationNavigation(sections, organizationId, path);
  const owner = AREAS.filter((area) => {
    const href = areaHref(organizationId, area.segment);
    return path === href || path.startsWith(`${href}/`);
  }).sort((a, b) => areaHref(organizationId, b.segment).length - areaHref(organizationId, a.segment).length)[0];
  const configurationOwner = workspaceConfigurationOwner(path);
  if (!configurationOwner && (!owner?.workspace || owner.group !== 'workspaces')) return null;
  const workspace = projectedItems(sections).find((item) => item.key === `workspace-${configurationOwner ?? owner?.workspace}`);
  if (!workspace?.destinations) return null;
  if (configurationOwner && !workspace.configuration) {
    // Configuration with no branch of its own belongs to the destination that edits it. The root is
    // the workspace's own only when it has such destinations; otherwise it is not this workspace's to show.
    const editors = workspace.destinations.filter((item) => item.activeHrefs?.length);
    const editedFrom = editors.some((item) => (item.activeHrefs ?? []).some((href) => path === href || path.startsWith(`${href}/`)));
    return editedFrom || (editors.length > 0 && path === workspaceConfigurationHref(organizationId, configurationOwner)) ? workspaceContext(workspace, organizationId) : null;
  }
  if (configurationOwner && workspace.configuration) {
    const target = workspaceConfigurationTarget(path);
    const registered = target ? `/organizations/${organizationId}/${target.path}` : workspace.configuration.href;
    const allowed = target ? workspace.configuration.activeHrefs?.includes(registered) : path === registered;
    const numberRead = owner?.segment === 'comms-numbers' && workspace.activeHrefs?.includes(areaHref(organizationId, owner.segment));
    if (!allowed && !numberRead) return null;
  } else if ((configurationOwner && owner?.segment !== 'comms-numbers') || !owner || !workspace.activeHrefs?.includes(areaHref(organizationId, owner.segment))) return null;
  return workspaceContext(workspace, organizationId);
}

/** Every item, flat, in the order it is drawn: a parent, then its pages. */
export function projectedItems(sections: readonly ShellSection[]): NavItem[] {
  const flatten = (item: NavItem): NavItem[] => [item, ...(item.children ?? []).flatMap(flatten)];
  return sections.flatMap((section) => section.items.flatMap(flatten));
}

/** Every item a person could be sent to from the projection, including entered-only destinations. */
export function reachableItems(sections: readonly ShellSection[]): NavItem[] {
  const walk = (item: NavItem): NavItem[] => [item, ...[
    ...(item.children ?? []),
    ...(item.destinations ?? []),
    ...(item.configuration ? [item.configuration] : []),
    ...(item.administration ? [item.administration] : []),
  ].flatMap(walk)];
  return sections.flatMap((section) => section.items.flatMap(walk));
}

/** Whether `key` is this item or one of its pages — what keeps a branch open while somebody is inside it. */
export function itemContains(item: NavItem, key: string | null): boolean {
  if (!key) return false;
  return item.key === key || (item.children ?? []).some((child) => itemContains(child, key));
}

/**
 * Which item a pathname is **in**. The longest matching href wins, so `/settings/plan` marks Plan &
 * usage rather than Settings and a Platform plan's page marks Plans rather than Catalog — a detail
 * route highlights the item that owns it, and only that one. A page and its parent can share an
 * address (a Platform group opens its first page); the page comes later in the flattened order and
 * wins the tie.
 */
export function activeItemKey(sections: readonly ShellSection[], pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, '');
  let best: NavItem | null = null;
  let bestLength = -1;
  for (const item of projectedItems(sections)) {
    for (const href of [item.href, ...(item.activeHrefs ?? [])]) {
      const inside = item.exact ? path === href : path === href || path.startsWith(`${href}/`);
      if (inside && href.length >= bestLength) {
        best = item;
        bestLength = href.length;
      }
    }
  }
  return best?.key ?? null;
}

/** Whether a pathname is a Platform Administration address beneath an organization. */
export function inPlatformScope(pathname: string): boolean {
  return platformSubpath(pathname) !== null;
}

/**
 * A workspace Home's chosen shortcuts, taken from the projection the sidebar draws — so route,
 * authorization and (business) label are the registry's, never the page's. The Home decides only
 * which ones to show and in what order; anything this person may not use is simply absent.
 */
export function workspaceShortcuts(
  sections: readonly ShellSection[],
  workspace: string,
  pick: { destinations?: readonly string[]; calendar?: boolean; configuration?: readonly string[] },
): NavItem[] {
  const row = sections.flatMap((section) => section.items).find((item) => item.key === `workspace-${workspace}`);
  if (!row) return [];
  const destinations = (pick.destinations ?? []).map((key) => row.destinations?.find((item) => item.key === key));
  const configuration = (pick.configuration ?? []).map((key) => row.configureDoors?.find((item) => item.key === key));
  return [...destinations, ...(pick.calendar && row.calendar ? [row.calendar] : []), ...configuration].filter((item): item is NavItem => Boolean(item));
}

/** The business's landing item for the persistent phone Home control. */
export function shellHomeItem(sections: readonly ShellSection[]): NavItem | undefined {
  return sections.find((section) => section.key === 'home')?.items.find(item => item.key === 'home');
}


export type LocationNavigation = {
  organizationId: string;
  sections: readonly ShellSection[];
  /** Authorized configuration destinations already projected by the server. */
  configurationHrefs?: readonly string[];
  /** The shell's own entitlement and permission facts, for `resolveLocation`'s ancestor links. */
  access?: SerializedLocationAccess;
};

export type PageNavigation = {
  parentHref?: string;
  activeKey: string | null;
  /** Optional linked grouping for non-workspace contexts. Workspace identity stays plain text. */
  groups: { label: string | null; href?: string; current?: boolean; items: NavItem[] }[];
};

/** Page-published ancestors and the authorized shell projection share one semantic location. */
export function pageNavigation(navigation: LocationNavigation | undefined, pathname: string, ancestorHrefs: readonly (string | undefined)[]): PageNavigation {
  const empty: PageNavigation = { activeKey: null, groups: [] };
  if (!navigation) return empty;
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, '');
  const pathOrganization = organizationIdFromPath(path);
  // Personal Settings may be composed inside this organization's verified shell.
  if (pathOrganization !== navigation.organizationId && !(platformSubpath(path) !== null && navigation.sections.some(section => section.key === 'administration')) && !(path === '/settings/account' || path.startsWith('/settings/account/'))) return empty;
  const { sections } = navigation;
  const cleanPath = (href: string) => href.split(/[?#]/)[0].replace(/\/$/, '');
  const inScope = (href: string) => (platformSubpath(href) !== null && sections.some(section => section.key === 'administration')) || organizationIdFromPath(href) === navigation.organizationId || cleanPath(href) === '/settings/account' || cleanPath(href).startsWith('/settings/account/');
  const configurationRoot = navigation.configurationHrefs?.filter((href) => inScope(href) && (path === href || path.startsWith(`${href}/`))).sort((a, b) => b.length - a.length)[0];
  const configuredWorkspace = configurationRoot ? configTargetForHref(configurationRoot)?.workspace : undefined;
  const configurationWorkspace = configuredWorkspace ? projectedItems(sections).find((item) => item.key === `workspace-${configuredWorkspace}`) : undefined;
  const workspace = workspaceNavigation(sections, path) ?? (configurationWorkspace ? workspaceNavigation(sections, configurationWorkspace.href) : null);
  const scoped = workspace?.sections ?? sections;
  const scopeItems = projectedItems(scoped);
  const activeKey = activeItemKey(scoped, path);
  const active = scopeItems.find((item) => item.key === activeKey);
  const allowed = new Set([
    ...reachableItems(sections).flatMap((item) => [item.href, ...(item.activeHrefs ?? [])]),
    ...(navigation.configurationHrefs ?? []),
  ].filter(inScope).map(cleanPath));
  const validAncestor = (href: string | undefined): href is string => {
    if (!href || !href.startsWith('/') || href.startsWith('//')) return false;
    const base = href.split(/[?#]/)[0].replace(/\/$/, '');
    return base !== path && allowed.has(base);
  };
  const ancestor = [...ancestorHrefs].reverse().find(validAncestor);
  const home = shellHomeItem(sections);
  const registeredParent = active && active.href !== path && path.startsWith(`${active.href}/`) ? active.href : undefined;
  const parentHref = ancestor ?? (configurationRoot && configurationRoot !== path ? configurationRoot : undefined) ?? registeredParent
    ?? (workspace && workspace.workspace.href !== path ? workspace.workspace.href : undefined)
    ?? (home && inScope(home.href) && home.href !== path ? home.href : undefined);

  const groups: PageNavigation['groups'] = [];
  // Dropdowns stay in the owning context (a workspace or Administration); Settings uses its own supplied projection.
  if (workspace || sections.some((section) => section.key.startsWith('settings-'))) {
    const append = (items: NavItem[], label: string | null, href?: string) => {
      const leaves = items.filter((item) => inScope(item.href) && !item.children).map((item) => ({ ...item, children: undefined }));
      // Non-workspace linked groups may retain their own destination; workspaces use Dashboard items.
      const heading = href && inScope(href) ? { href, current: cleanPath(href) === path } : {};
      if (leaves.length || 'href' in heading) groups.push({ label, ...heading, items: leaves });
      for (const item of items) if (item.children) append(item.children, item.label);
    };
    for (const section of scoped) append(section.items, section.label, section.href);
  }
  return { parentHref, activeKey, groups };
}
