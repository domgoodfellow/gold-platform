import {
  AREAS,
  areaEntitled,
  areaHref,
  areaVisibleTo,
  CONFIG_TARGETS,
  configTarget,
  configTargetOffered,
  type Area,
} from '@/lib/navigation';
import { platformDestinationsFor } from '@/lib/platform-navigation';
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
 */
export type ShellSectionKey = 'home' | 'workspaces' | 'operations' | 'administration' | 'platform';

export type NavItem = {
  /** Unique across the whole projection; also the icon key. */
  key: string;
  label: string;
  href: string;
  section: ShellSectionKey;
};

export type ShellSection = {
  key: ShellSectionKey;
  /** `null` draws no heading — Home and the main workspace list name themselves. */
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
  workspaces: null,
  operations: 'Operations',
  administration: 'Administration',
  platform: 'Platform',
};

function areaItem(organizationId: string, area: Area, section: ShellSectionKey): NavItem {
  return { key: area.segment, label: area.label, href: areaHref(organizationId, area.segment), section };
}

/**
 * The organization administration a member may reach, one item at a time by the authority for that
 * item — there is no Administration section a role either has or lacks. Each item is a
 * configuration target (`CONFIG_TARGETS`), so it is offered by the same rule as its Settings entry.
 * Settings itself is the index of every target and is drawn when at least one is offered.
 */
const ADMINISTRATION_ITEMS: readonly { key: string; label: string; target: string }[] = [
  { key: 'team', label: 'Team', target: 'team' },
  { key: 'connections', label: 'Connections', target: 'integrations' },
  { key: 'plan', label: 'Plan & usage', target: 'plan' },
];

export function projectShell(input: ShellInput): ShellSection[] {
  const { organizationId, enabledModules, featureAvailability, capabilities, platform } = input;
  const gate = { enabledModules, featureAvailability, capabilities };

  const operable = (area: Area) =>
    area.sidebar !== false &&
    areaEntitled(area, enabledModules, featureAvailability) &&
    areaVisibleTo(area, capabilities);

  const inGroup = (group: Area['group']) => AREAS.filter((area) => area.group === group && operable(area));

  const administration: NavItem[] = [];
  for (const item of ADMINISTRATION_ITEMS) {
    const target = configTarget(item.target);
    if (!configTargetOffered(target, gate)) continue;
    administration.push({
      key: item.key,
      label: item.label,
      href: `/organizations/${organizationId}/${target.path.split('#')[0]}`,
      section: 'administration',
    });
  }
  const settings = AREAS.find((area) => area.segment === 'settings')!;
  if (CONFIG_TARGETS.some((target) => configTargetOffered(target, gate))) {
    administration.push(areaItem(organizationId, settings, 'administration'));
  }

  const platformItems: NavItem[] = platform
    ? platformDestinationsFor(platform).map((destination) => ({
        key: `platform-${destination.key}`,
        label: destination.label,
        href: destination.href,
        section: 'platform' as const,
      }))
    : [];

  const sections: ShellSection[] = [
    { key: 'home', label: SECTION_LABELS.home, items: inGroup('home').map((area) => areaItem(organizationId, area, 'home')) },
    { key: 'workspaces', label: SECTION_LABELS.workspaces, items: inGroup('workspaces').map((area) => areaItem(organizationId, area, 'workspaces')) },
    { key: 'operations', label: SECTION_LABELS.operations, items: inGroup('operations').map((area) => areaItem(organizationId, area, 'operations')) },
    { key: 'administration', label: SECTION_LABELS.administration, items: administration },
    { key: 'platform', label: SECTION_LABELS.platform, items: platformItems },
  ];

  // A section with nothing in it is not drawn: naming a part of the product that is not there for
  // this person is worse than the gap.
  return sections.filter((section) => section.items.length > 0);
}

/** Every item, flat, in the order it is drawn. */
export function projectedItems(sections: readonly ShellSection[]): NavItem[] {
  return sections.flatMap((section) => section.items);
}

/**
 * Which item a pathname is **in**. The longest matching href wins, so `/settings/plan` marks Plan &
 * usage rather than Settings and `/platform/catalog/plans/x` marks Plans rather than Catalog — a
 * detail route highlights the item that owns it, and only that one.
 */
export function activeItemKey(sections: readonly ShellSection[], pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, '');
  let best: NavItem | null = null;
  for (const item of projectedItems(sections)) {
    const inside =
      item.href === '/platform' ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
    if (inside && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** How many workspaces the phone bar carries beside Home before the rest go behind More. */
export const PHONE_PRIMARY_WORKSPACES = 3;

/**
 * The phone's rendering of the same projection: frequent work in the bar, everything else behind
 * one More menu. Not a second eligibility rule — every item still comes from `projectShell` — only
 * a choice of which of them a thumb reaches first: Home, then the first workspaces in the order the
 * business's own projection lists them. Administration and Platform are always behind More, so they
 * are reachable and never crowd the frequent work.
 */
export function projectPhone(sections: readonly ShellSection[]): { primary: NavItem[]; more: ShellSection[] } {
  const home = sections.find((section) => section.key === 'home')?.items ?? [];
  const workspaces = sections.find((section) => section.key === 'workspaces')?.items ?? [];
  const primary = [...home, ...workspaces.slice(0, PHONE_PRIMARY_WORKSPACES)];
  const inBar = new Set(primary.map((item) => item.key));

  const more = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !inBar.has(item.key)) }))
    .filter((section) => section.items.length > 0);

  return { primary, more };
}
