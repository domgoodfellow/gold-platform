import type { CSSProperties } from 'react';

/**
 * The workspace's vertical rhythm, written once. Workspace-global tools (Agent) align to the
 * workspace header band; page-local tools (Configure and every page drawer) start beneath it. No route or panel writes a margin to get there — each reads these.
 *
 * Class strings are whole literals so Tailwind can see them.
 */

/** The workspace header's height — the top band Agent's own header shares. */
export const HEADER_HEIGHT = '3.5rem';
export const HEADER_HEIGHT_STYLE = { '--header-height': HEADER_HEIGHT } as CSSProperties;

/** The canvas inset every page sits in. */
export const PAGE_PADDING = 'p-4 sm:p-6 lg:p-8';

/** The space after a page's last element: the canvas inset's bottom edge, as a real child so it scrolls with the page. */
export const PAGE_BOTTOM_CLEARANCE = 'h-4 sm:h-6 lg:h-8';

/** Phone only: also clears the persistent navigation bar, which sits over the bottom of the scroller. */
export const PAGE_BOTTOM_CLEARANCE_WITH_NAV = 'max-md:h-[calc(var(--mobile-nav-height,0px)+1.5rem)]';

/**
 * A drawer's own chrome: one compact band, deliberately thinner than the workspace header, so the
 * form beneath it gets the height. Every drawer and Configure rail reads these and nothing else.
 * The close button is `size-8`, centred in the band by `DRAWER_CLOSE_OFFSET`.
 */
export const DRAWER_HEADER = 'min-h-12 py-2 pl-4 pr-14';
export const DRAWER_CLOSE_OFFSET = 'top-2'; 

/**
 * The persistent phone navigation bar's full height, safe-area inset included. Exposed as
 * `--mobile-nav-height` by a shell that has such a bar (`WorkspaceShell`); every consumer — the page's
 * bottom inset, the bar itself, the phone Agent panel — reads the variable, never a copy of the number.
 * A shell with no bar leaves it unset, and consumers fall back to `0px`.
 */
export const MOBILE_NAV_HEIGHT = 'calc(3.5rem + env(safe-area-inset-bottom))';
export const MOBILE_NAV_HEIGHT_STYLE = { '--mobile-nav-height': MOBILE_NAV_HEIGHT } as CSSProperties;
