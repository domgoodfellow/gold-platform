import { organizationIdFromPath } from '@/lib/route/platform-context';
import { settingsScopeHref } from '@/lib/route/settings';
import {
  AREAS,
  WORKSPACES,
  areaEntitled,
  areaHref,
  areaRelevantToShape,
  areaVisibleTo,
  configTarget,
  configTargetOffered,
  type Area,
} from '@/lib/navigation';
import {
  PLATFORM_GROUPS,
  platformDestinationsFor,
  platformHref,
  platformSubpath,
  type PlatformDestination,
} from '@/lib/platform-navigation';
import type { PlatformCapability } from '@/lib/domain/platform/permissions';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/** One eligibility projection for all breakpoints. Business Home is the operational cockpit;
 * Work owns concrete execution. Platform is a separate system context, never a tenant workspace.
 * Visibility is courtesy: each destination continues enforcing its own authority.
 */
export type ShellSectionKey = 'home' | 'library' | 'workspaces' | 'platform';

export type NavItem = {
  /** Unique across the whole projection; also the icon key. */
  key: string;
  label: string;
  href: string;
  section: ShellSectionKey;
  /** Operable Area addresses that activate this flat workspace row. */
  activeHrefs?: string[];
  /**
   * The destinations grouped under a Platform heading. A parent is
   * itself a destination (a workspace has an overview; a Platform group opens its first page), so
   * a renderer without room for children — the collapsed rail — can still link to it.
   */
  children?: NavItem[];
  /** Matches only its own address, not everything beneath it: the Platform overview is the root of a whole tree. */
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
  platform: null,
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

/** The existing nested system navigation, filtered by canonical Platform permissions. */
function projectPlatform(organizationId: string, permissions: ReadonlySet<PlatformCapability>): NavItem[] {
  const destinations = platformDestinationsFor(permissions);
  if (destinations.length === 0) return [];

  const item = (destination: PlatformDestination): NavItem => ({
    key: `platform-${destination.key}`,
    label: destination.label,
    href: platformHref(organizationId, destination.path),
    section: 'platform',
  });

  const children: NavItem[] = [];
  const groupsDrawn = new Set<string>();
  for (const destination of destinations) {
    // The root is the parent row's own destination, represented by the row itself — never a
    // second "Overview" child beneath it.
    if (destination.path === '') continue;
    if (destination.under) {
      if (groupsDrawn.has(destination.under)) continue;
      groupsDrawn.add(destination.under);
      const group = PLATFORM_GROUPS.find((candidate) => candidate.key === destination.under)!;
      const pages = destinations.filter((candidate) => candidate.under === group.key).map(item);
      children.push({
        key: `platform-group-${group.key}`,
        label: group.label,
        href: pages[0].href,
        section: 'platform',
        heading: true,
        children: pages,
      });
      continue;
    }
    children.push(item(destination));
  }

  const root: NavItem = {
    key: 'platform',
    label: 'Platform',
    href: platformHref(organizationId, ''),
    section: 'platform',
    exact: true,
  };
  return [children.length === 0 ? root : { ...root, heading: true, children }];
}

/** The existing nested Platform IA, projected only for the separate system context. */
export function projectPlatformShell(organizationId: string, permissions: ReadonlySet<PlatformCapability>): ShellSection[] {
  const items = projectPlatform(organizationId, permissions);
  return items.length ? [{ key: 'platform', label: null, items }] : [];
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

  const operable = (area: Area) =>
    area.sidebar !== false &&
    areaEntitled(area, enabledModules, featureAvailability) &&
    areaVisibleTo(area, capabilities) &&
    areaRelevantToShape(area, schedulableWork);

  const inGroup = (group: Area['group']) => AREAS.filter((area) => area.group === group && operable(area));

  // A real, operable Home earns one flat row; registered workspaces without Homes stay absent.
  const workspaceItems = (): NavItem[] => WORKSPACES.flatMap((workspace) => {
    const areas = AREAS.filter((area) => area.workspace === workspace.key && operable(area));
    const home = workspace.home ? areas.find((area) => area.segment === workspace.home) : undefined;
    if (!home) return [];
    return [{
      key: `workspace-${workspace.key}`,
      label: workspace.label,
      href: areaHref(organizationId, home.segment),
      section: 'workspaces',
      activeHrefs: areas.map((area) => areaHref(organizationId, area.segment)),
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

/** Every item, flat, in the order it is drawn: a parent, then its pages. */
export function projectedItems(sections: readonly ShellSection[]): NavItem[] {
  const flatten = (item: NavItem): NavItem[] => [item, ...(item.children ?? []).flatMap(flatten)];
  return sections.flatMap((section) => section.items.flatMap(flatten));
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

/** Whether a pathname is inside GOLD's Platform sub-scope — the one fact the sidebar disclosure follows. */
export function inPlatformScope(pathname: string): boolean {
  return platformSubpath(pathname) !== null;
}

/** A URL selects a system identity only within the already resolved canonical Platform context. */
export function selectShellContext(organizationId: string, pathname: string, platform: { organizationId: string } | null): 'business' | 'platform' {
  return platform?.organizationId === organizationId && organizationIdFromPath(pathname) === organizationId && inPlatformScope(pathname) ? 'platform' : 'business';
}

/** The current context's landing item for the persistent phone Home control. */
export function shellHomeItem(sections: readonly ShellSection[]): NavItem | undefined {
  return sections.find((section) => section.key === 'home')?.items[0]
    ?? sections.find((section) => section.key === 'platform')?.items[0];
}
