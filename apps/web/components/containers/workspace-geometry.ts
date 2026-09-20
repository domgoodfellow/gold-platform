import type { CSSProperties } from 'react';

/**
 * The workspace's vertical rhythm, written once. Workspace-global tools (Agent) align to the
 * workspace header band; page-local tools (Configure and every page drawer) align to the page's
 * own chrome beneath it. No route or panel writes a margin to get there — each reads these.
 *
 * Class strings are whole literals so Tailwind can see them.
 */

/** The workspace header's height — the top band Agent's own header shares. */
export const HEADER_HEIGHT = '3.5rem';
export const HEADER_HEIGHT_STYLE = { '--header-height': HEADER_HEIGHT } as CSSProperties;

/** The canvas inset every page sits in, and the top edge `PageHeader` starts at. */
export const PAGE_PADDING = 'p-4 sm:p-6 lg:p-8';
export const PAGE_PADDING_TOP = 'pt-4 sm:pt-6 lg:pt-8';
export const PAGE_TOP_OFFSET = 'top-4 sm:top-6 lg:top-8';

/** `PageHeader`'s `<h1>` is `text-2xl`, a 2rem line; a drawer's title row is the same height. */
export const PAGE_TITLE_ROW = 'min-h-8';
