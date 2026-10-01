import {
  AREAS,
  WORKSPACES,
  areaEntitled,
  areaHref,
  areaVisibleTo,
  CONFIG_TARGETS,
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

/**
 * The shell is a **projection**: what one person sees in one organization is derived, in one place,
 * from four independent facts —
 *
 *   the organization's entitlements   (which modules and features it has),
 *   the member's permissions          (which capabilities their roles grant),
 *   the organization's identity       (is it GOLD's own workspace?), and
 *   the member's platform authority   (which platform permissions their staff row names).
 *
 * Every renderer — the desktop sidebar, the collapsed rail, the tablet rail, the phone bar and its
 * More menu, the Settings map — consumes what this returns and decides nothing. There is no
 * `isOwner`, `isAdmin`, `isGold` or `isPlatformStaff` anywhere downstream, and no role name: a role
 * is an editable bundle of capabilities, and behaviour asks about capabilities. Hiding an item is
 * courtesy; the page, the domain function and the policy behind it still refuse (I12).
 *
 * Entitlement and permission are **separate questions, both required**: a business without
 * Communications has no calling workspace for its owner, and a member without `call.place` does not
 * operate calling in a business that has it.
 *
 * The shape is a hierarchy: a **workspace** is where an operator performs ongoing work (`WORKSPACES`), and
 * its **pages** are the areas that name it (`Area.workspace`). A Plan grants capabilities, a Product
 * groups them, a workspace is where they are used and a page is one task in it — four different
 * things, and only the last two are navigation. One real page makes the workspace a plain row;
 * several make it an expandable one. A registered workspace with no reachable page has no row at
 * all: registered is not visible.
 */
export type ShellSectionKey = 'home' | 'library' | 'workspaces' | 'business' | 'platform';

export type NavItem = {
  /** Unique across the whole projection; also the icon key. */
  key: string;
  label: string;
  href: string;
  section: ShellSectionKey;
  /**
   * The pages of a workspace, or the destinations grouped under a Platform heading. A parent is
   * itself a destination (a workspace has an overview; a Platform group opens its first page), so
   * a renderer without room for children — the collapsed rail — can still link to it.
   */
  children?: NavItem[];
  /** Matches only its own address, not everything beneath it: the Platform overview is the root of a whole tree. */
  exact?: boolean;
  /** Kept in the phone bar's primary slots when there is room — the frequent work, however the sidebar nests it. */
  phone?: boolean;
  /**
   * A heading that has no page of its own: its `href` is its first page's, so the collapsed rail has
   * somewhere to go, and the phone's More menu does not list it a second time as an overview.
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
  /**
   * The member's platform permissions **when, and only when, this is GOLD's own organization**.
   * `null` everywhere else — including a customer's business the same person is looking at — so
   * the platform control plane never appears beside a tenant's own work.
   */
  platform: ReadonlySet<PlatformCapability> | null;
};

const SECTION_LABELS: Record<ShellSectionKey, string | null> = {
  home: null,
  library: null,
  workspaces: 'Workspaces',
  business: 'Business',
  platform: 'Platform administration',
};

/**
 * The scope hierarchy, top to bottom: routine operating work, then administration of this business,
 * then administration of the platform. Not a count of permissions — a widening of what a click can
 * change. `projectShell` returns sections in this order and a renderer settles the last two toward
 * the bottom of the sidebar, so the highest authority is the furthest from the daily work.
 */
export const SHELL_SECTION_ORDER: readonly ShellSectionKey[] = ['home', 'library', 'workspaces', 'business', 'platform'];

/** The sections that are administration rather than operating work: drawn as one block, at the foot. */
export const ADMINISTRATION_SECTIONS: ReadonlySet<ShellSectionKey> = new Set(['business', 'platform']);

function areaItem(organizationId: string, area: Area, section: ShellSectionKey): NavItem {
  return {
    key: area.segment,
    label: area.label,
    href: areaHref(organizationId, area.segment),
    section,
    ...(area.phone ? { phone: true } : {}),
  };
}

/**
 * The Business section: administration of the current organization a member may reach, one item at a
 * time by the authority for that item — there is no Business section a role either has or lacks. Each item is a
 * configuration target (`CONFIG_TARGETS`), so it is offered by the same rule as its Settings entry.
 * Settings itself is the index of every target and is drawn when at least one is offered.
 */
const BUSINESS_ITEMS: readonly { key: string; label: string; target: string }[] = [
  { key: 'team', label: 'Team', target: 'team' },
  { key: 'connections', label: 'Connections', target: 'integrations' },
  { key: 'plan', label: 'Plan & usage', target: 'plan' },
];

/**
 * The Platform section, from the one registry: the destinations the caller's permissions reach,
 * nested beneath one workspace-style parent row — Platform itself, the same shape a workspace
 * takes in `workspaceItems()` below (a row that is both a link to its own Home and a disclosure
 * over its pages). Its Home is the root destination (`PLATFORM_DESTINATIONS`'s `overview`), never
 * repeated as a child beneath its own parent — the same rule every workspace's Home already
 * follows. Catalog, Commercial and Infrastructure are headings one level further in, each opening
 * its own first page; a heading none of whose pages the caller reaches is not drawn. A permission
 * set that reaches nothing produces no row at all.
 */
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
  };
  // Somebody holding only `platform.health` reaches the overview and nothing else: a plain row,
  // never a chevron over an empty disclosure — the same rule a workspace with one reachable area
  // follows.
  return [children.length === 0 ? root : { ...root, heading: true, children }];
}

/**
 * Whether this business's Organization Settings scope has anything this member may configure —
 * the same gate the Business section once used to draw a permanent Settings row (D-restated:
 * Settings is not one of the permanent rows, per the shell-chrome slice). The account menu's one
 * Settings entry (D71) asks this to decide whether it lands on Organization or falls back to
 * Account; any contextual Configure link asks it the same way before offering a destination at all.
 */
export function businessSettingsOffered(input: Pick<ShellInput, 'enabledModules' | 'featureAvailability' | 'capabilities'>): boolean {
  const gate = { enabledModules: input.enabledModules, featureAvailability: input.featureAvailability, capabilities: input.capabilities };
  return CONFIG_TARGETS.some((target) => configTargetOffered(target, gate));
}

export function projectShell(input: ShellInput): ShellSection[] {
  const { organizationId, enabledModules, featureAvailability, capabilities, platform } = input;
  const gate = { enabledModules, featureAvailability, capabilities };

  const operable = (area: Area) =>
    area.sidebar !== false &&
    areaEntitled(area, enabledModules, featureAvailability) &&
    areaVisibleTo(area, capabilities);

  const inGroup = (group: Area['group']) => AREAS.filter((area) => area.group === group && operable(area));

  // A workspace composes pages and capabilities independently of Products: each page is still gated by its own module and capability, so
  // a business without Assets has a Field without that page. The parent row's own destination is
  // the workspace's canonical Home (`WORKSPACES[].home`), never the first child — a Home is never
  // repeated as a child beneath its own parent. What the row is is decided by how many areas are
  // real — none, no row; one (Home alone, or a workspace with no declared Home and one page),
  // a plain row; several, an expandable one. Never a dropdown of one, and never a row for a
  // Product with nothing behind it.
  const workspaceItems = (): NavItem[] =>
    WORKSPACES.flatMap((workspace) => {
      const areas = AREAS.filter((area) => area.workspace === workspace.key && operable(area));
      // Plan & Add-on administration (D25's commercial-packaging side of Catalogue/Plan) is a real
      // Finance page, not Settings-reached configuration — but it exists only for GOLD's own
      // organization and a staff row naming `platform.commercial`, a fact `AREAS` cannot express
      // (it gates on this organization's own modules/capabilities, never on being GOLD). `platform`
      // already carries exactly that fact, so it is read here rather than teaching `Area` a second
      // kind of gate for one page.
      const financePlatformChildren: NavItem[] =
        workspace.key === 'finance' && platform?.has('platform.commercial')
          ? [{ key: 'finance-plans', label: 'Plans & Add-ons', href: `/organizations/${organizationId}/finance/plans`, section: 'workspaces' }]
          : [];
      if (areas.length === 0 && financePlatformChildren.length === 0) return [];
      const home = workspace.home ? areas.find((area) => area.segment === workspace.home) : undefined;
      const childAreas = home ? areas.filter((area) => area.segment !== home.segment) : areas;
      const children = [...childAreas.map((area) => areaItem(organizationId, area, 'workspaces')), ...financePlatformChildren];
      const homeItem = home ? areaItem(organizationId, home, 'workspaces') : children[0];
      const row: NavItem = {
        key: `workspace-${workspace.key}`,
        label: workspace.label,
        href: homeItem.href,
        section: 'workspaces',
      };
      if (areas.length === 1 && financePlatformChildren.length === 0) return [{ ...row, ...(homeItem.phone ? { phone: true } : {}) }];
      return [{ ...row, heading: true, children: home ? children : children.slice(1) }];
    });

  const business: NavItem[] = [];
  for (const item of BUSINESS_ITEMS) {
    const target = configTarget(item.target);
    if (!configTargetOffered(target, gate)) continue;
    business.push({
      key: item.key,
      label: item.label,
      href: `/organizations/${organizationId}/${target.path.split('#')[0]}`,
      section: 'business',
    });
  }

  const platformItems: NavItem[] = platform ? projectPlatform(organizationId, platform) : [];

  const sections: ShellSection[] = [
    { key: 'home', label: SECTION_LABELS.home, items: inGroup('home').map((area) => areaItem(organizationId, area, 'home')) },
    { key: 'library', label: SECTION_LABELS.library, items: inGroup('library').map((area) => areaItem(organizationId, area, 'library')) },
    { key: 'workspaces', label: SECTION_LABELS.workspaces, items: workspaceItems() },
    { key: 'business', label: SECTION_LABELS.business, items: business },
    { key: 'platform', label: SECTION_LABELS.platform, items: platformItems },
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
  for (const item of projectedItems(sections)) {
    const inside = item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
    if (inside && (!best || item.href.length >= best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** Whether a pathname is inside GOLD's Platform sub-scope — the one fact the phone presentation and the Agent both follow. */
export function inPlatformScope(pathname: string): boolean {
  return platformSubpath(pathname) !== null;
}

/** How many workspace pages the phone bar carries beside Home before the rest go behind More. */
export const PHONE_PRIMARY_WORKSPACES = 3;

/**
 * The phone's rendering of the same projection, chosen by where the person is. It is a choice of
 * which items a thumb reaches first, never a second eligibility rule — every item still comes from
 * `projectShell`.
 *
 * **In a business:** Home, then the workspace pages marked `phone` (Customers, Work, Schedule) in
 * the order the projection lists them — a workspace with pages contributes its pages, so the
 * frequent work stays one tap away however the sidebar nests it — and everything else behind one
 * More menu, grouped as the desktop groups it.
 *
 * **In Platform:** the bar carries a way back to Home and Platform's own first-level destinations
 * — Organizations, Catalog, Commercial, Infrastructure, unwrapped from the one Platform row the
 * sidebar nests them under — and everything beneath those (a group's own pages, and all of GOLD's
 * own workspaces) sits behind More. Ten Platform destinations and every workspace never share one
 * bar.
 */
export function projectPhone(
  sections: readonly ShellSection[],
  options: { platformActive?: boolean } = {},
): { primary: NavItem[]; more: ShellSection[] } {
  const home = sections.find((section) => section.key === 'home')?.items ?? [];
  const platformRoot = sections.find((section) => section.key === 'platform')?.items[0];

  if (options.platformActive && platformRoot) {
    // The Platform row itself is never a primary button beside its own destinations — the same
    // "never repeat Home as a child" rule, read the other way round: its children are what a thumb
    // reaches first, and a `platformRoot` with none (just `platform.health`) falls back to itself.
    const primary = [...home, ...(platformRoot.children ?? [platformRoot])];
    return { primary, more: phoneMore(sections, new Set(primary.map((item) => item.key)), true) };
  }

  const workspaces = sections.find((section) => section.key === 'workspaces')?.items ?? [];
  const pages = workspaces.flatMap((item) => item.children ?? [item]).filter((item) => item.phone);
  const primary = [...home, ...pages.slice(0, PHONE_PRIMARY_WORKSPACES)];
  return { primary, more: phoneMore(sections, new Set(primary.map((item) => item.key)), false) };
}

/**
 * Everything beneath one list of items the bar does not carry: items with no children of their own
 * stay loose, under whichever heading is calling this (a section's own label, or recursively a
 * parent's), and an item with children becomes its own named group, holding its own overview
 * (unless the bar already links to it, or it has none to repeat) and whichever of its children the
 * bar left out — themselves expanded the same way, so a group nested inside a group (Platform's
 * Catalog, Commercial and Infrastructure, one level inside Platform's own row) surfaces as its own
 * entry exactly as a top-level one would, to any depth, with no case built for Platform by name.
 */
function expand(
  items: readonly NavItem[],
  inBar: ReadonlySet<string>,
): { loose: NavItem[]; groups: { label: string; items: NavItem[] }[] } {
  const loose: NavItem[] = [];
  const groups: { label: string; items: NavItem[] }[] = [];

  for (const item of items) {
    if (!item.children) {
      if (!inBar.has(item.key)) loose.push(item);
      continue;
    }
    const nested = expand(item.children, inBar);
    const overview: NavItem[] =
      inBar.has(item.key) || item.heading ? [] : [{ ...item, label: 'Overview', children: undefined }];
    const own = [...overview, ...nested.loose];
    if (own.length > 0) groups.push({ label: item.label, items: own });
    groups.push(...nested.groups);
  }

  return { loose, groups };
}

/** Everything the bar does not carry, as flat sections — one per `expand` group, grouped under each section it came from. */
function phoneMore(
  sections: readonly ShellSection[],
  inBar: ReadonlySet<string>,
  platformFirst: boolean,
): ShellSection[] {
  const out: ShellSection[] = [];

  for (const section of sections) {
    if (section.key === 'home') continue;
    const { loose, groups } = expand(section.items, inBar);
    // One list under the section's own heading, then a list per group: a section's name is never
    // printed twice in the same menu.
    if (loose.length > 0) out.push({ key: section.key, label: section.label, items: loose });
    out.push(...groups.map((group) => ({ key: section.key, label: group.label, items: group.items })));
  }

  if (!platformFirst) return out;
  return [...out.filter((entry) => entry.key === 'platform'), ...out.filter((entry) => entry.key !== 'platform')];
}
