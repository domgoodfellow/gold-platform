import type { PlatformCapability } from '@/lib/domain/platform/permissions';

/**
 * GildOps' own interface-design tools (Studio → Interface design) and the navigation preview they
 * switch. These are development concerns of the platform, never a business's branding: no tenant
 * capability, including `organization.manage`, reaches them.
 *
 * There is no dedicated development permission yet. Adding one means extending the
 * `platform_staff_capabilities_known` constraint, which is a migration, so this reuses the platform
 * permission over what GildOps' product consists of. Change this one value when a dedicated
 * permission exists.
 */
export const INTERFACE_DESIGN_CAPABILITY: PlatformCapability = 'platform.catalogue';

/**
 * The two arrangements of the organization sidebar. `contextual` is the default: entering a
 * workspace replaces the sidebar with that workspace's pages. `unified` keeps the six operating
 * workspaces as groups in one sidebar and gathers Studio, AI and Automations into Studio (ADR-056).
 */
export const NAVIGATION_LAYOUTS = ['contextual', 'unified'] as const;
export type NavigationLayout = (typeof NAVIGATION_LAYOUTS)[number];

/** Remembers one browser's choice. It is a presentation hint only: the shell honours it only for staff it has authorized itself. */
export const NAVIGATION_LAYOUT_COOKIE = 'gildops_navigation_layout';
export const NAVIGATION_LAYOUT_MAX_AGE = 60 * 60 * 24 * 30;

export function interfaceDesignHref(organizationId: string): string {
  return `/organizations/${organizationId}/studio/interface/navigation`;
}

/**
 * The layout this person sees. The stored value is never trusted on its own: without the interface
 * design permission, in this business, the answer is always the default. Neither layout changes what
 * the person may open; both draw the same authorized projection.
 */
export function navigationLayoutFor(stored: string | undefined, permissions: ReadonlySet<PlatformCapability> | null | undefined): NavigationLayout {
  return stored === 'unified' && permissions?.has(INTERFACE_DESIGN_CAPABILITY) ? 'unified' : 'contextual';
}
