/**
 * The sidebar's two browser-held preferences, readable on the server so the first render matches
 * what the browser will show. Neither holds anything about the account: one is a layout choice,
 * the other the device's viewport class.
 */

/** The desktop preference: "true" (docked, expanded) or "false" (icon rail). Written only by an explicit desktop choice. */
export const SIDEBAR_COOKIE_NAME = "sidebar_state"
/** The viewport class last seen in this browser. */
export const SIDEBAR_VIEWPORT_COOKIE_NAME = "sidebar_viewport"

/**
 * Phone (below 768px) uses the menu sheet. Tablet (768–1279px) shows the icon rail and expands only
 * as a temporary overlay that keeps the page its width. Desktop (1280px and above) docks the
 * sidebar, expanded or collapsed as the person last chose.
 */
export type SidebarViewport = "phone" | "tablet" | "desktop"

export type SidebarPreferences = { open: boolean; viewport: SidebarViewport }

/** Reads raw cookie values; anything missing or unrecognised falls back to an expanded desktop. */
export function sidebarPreferences(open: string | undefined, viewport: string | undefined): SidebarPreferences {
  return {
    open: open !== "false",
    viewport: viewport === "phone" || viewport === "tablet" ? viewport : "desktop",
  }
}
