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
 * The shape is a hierarchy: a **workspace** is where an operator uses a Product (`WORKSPACES`), and
 * its **pages** are the areas that name it (`Area.workspace`). A Plan grants capabilities, a Product
 * groups them, a workspace is where they are used and a page is one task in it — four different
 * things, and only the last two are navigation. One real page makes the workspace a plain row;
 * several make it an expandable one. A registered workspace with no reachable page has no row at
 * all: registered is not visible.
 */
export type ShellSectionKey = 'home' | 'workspaces' | 'business' | 'platform';

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
export const SHELL_SECTION_ORDER: readonly ShellSectionKey[] = ['home', 'workspaces', 'business', 'platform'];

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
 * nested as the registry says: Catalog, Commercial and Infrastructure are headings that open their
 * first page. A heading none of whose pages the caller reaches is not drawn, and a heading opens the
 * first of its pages, so it is a link as well as a disclosure.
 */
function projectPlatform(organizationId: string, permissions: ReadonlySet<PlatformCapability>): NavItem[] {
  const destinations = platformDestinationsFor(permissions);
  const item = (destination: PlatformDestination): NavItem => ({
    key: `platform-${destination.key}`,
    label: destination.label,
    href: platformHref(organizationId, destination.path),
    section: 'platform',
    ...(destination.path === '' ? { exact: true } : {}),
  });

  const items: NavItem[] = [];
  const groupsDrawn = new Set<string>();
  for (const destination of destinations) {
    if (destination.under) {
      if (groupsDrawn.has(destination.under)) continue;
      groupsDrawn.add(destination.under);
      const group = PLATFORM_GROUPS.find((candidate) => candidate.key === destination.under)!;
      const pages = destinations.filter((candidate) => candidate.under === group.key).map(item);
      items.push({
        key: `platform-group-${group.key}`,
        label: group.label,
        href: pages[0].href,
        section: 'platform',
        heading: true,
        children: pages,
      });
      continue;
    }
    items.push(item(destination));
  }
  return items;
}

/**
 * Whether Business settings has anything this member may configure — the same gate the Business
 * section once used to draw a permanent Settings row (D-restated: Settings is not one of the
 * permanent rows, per the shell-chrome slice). The account menu's "Business settings" link and any
 * contextual Configure link ask this before offering the destination at all.
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

  // A workspace is a Product with pages: each page still gated by its own module and capability, so
  // a business without Assets has a Field without that page. What the rows are is decided by how
  // many pages are real — none, no row; one, a plain row; several, an expandable one. Never a
  // dropdown of one, and never a row for a Product with nothing behind it.
  const workspaceItems = (): NavItem[] =>
    WORKSPACES.flatMap((workspace) => {
      const pages = AREAS.filter((area) => area.workspace === workspace.key && operable(area)).map((area) =>
        areaItem(organizationId, area, 'workspaces'),
      );
      if (pages.length === 0) return [];
      const row: NavItem = {
        key: `workspace-${workspace.key}`,
        label: workspace.label,
        href: pages[0].href,
        section: 'workspaces',
      };
      if (pages.length === 1) return [{ ...row, ...(pages[0].phone ? { phone: true } : {}) }];
      return [{ ...row, heading: true, children: pages }];
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
 * **In Platform:** the bar carries a way back to Home and the Platform destinations; the pages
 * under Catalog, Commercial and Infrastructure and all of GOLD's own workspaces sit behind More.
 * Ten Platform destinations and every workspace never share one bar.
 */
export function projectPhone(
  sections: readonly ShellSection[],
  options: { platformActive?: boolean } = {},
): { primary: NavItem[]; more: ShellSection[] } {
  const home = sections.find((section) => section.key === 'home')?.items ?? [];
  const platformItems = sections.find((section) => section.key === 'platform')?.items ?? [];

  if (options.platformActive && platformItems.length > 0) {
    const primary = [...home, ...platformItems];
    return { primary, more: phoneMore(sections, new Set(primary.map((item) => item.key)), true) };
  }

  const workspaces = sections.find((section) => section.key === 'workspaces')?.items ?? [];
  const pages = workspaces.flatMap((item) => item.children ?? [item]).filter((item) => item.phone);
  const primary = [...home, ...pages.slice(0, PHONE_PRIMARY_WORKSPACES)];
  return { primary, more: phoneMore(sections, new Set(primary.map((item) => item.key)), false) };
}

/**
 * Everything the bar does not carry, as flat sections. A parent with pages becomes a section
 * headed by its own name, holding its overview (unless the bar already links to it) and whichever
 * pages the bar left out.
 */
function phoneMore(
  sections: readonly ShellSection[],
  inBar: ReadonlySet<string>,
  platformFirst: boolean,
): ShellSection[] {
  const out: ShellSection[] = [];

  for (const section of sections) {
    if (section.key === 'home') continue;
    const loose: NavItem[] = [];
    const parents: ShellSection[] = [];

    for (const item of section.items) {
      if (!item.children) {
        if (!inBar.has(item.key)) loose.push(item);
        continue;
      }
      const pages = item.children.filter((page) => !inBar.has(page.key));
      const overview: NavItem[] =
        inBar.has(item.key) || item.heading ? [] : [{ ...item, label: 'Overview', children: undefined }];
      const items = [...overview, ...pages];
      if (items.length > 0) parents.push({ key: section.key, label: item.label, items });
    }

    // One list under the section's own heading, then a list per parent: a section's name is never
    // printed twice in the same menu.
    if (loose.length > 0) out.push({ key: section.key, label: section.label, items: loose });
    out.push(...parents);
  }

  if (!platformFirst) return out;
  return [...out.filter((entry) => entry.key === 'platform'), ...out.filter((entry) => entry.key !== 'platform')];
}
