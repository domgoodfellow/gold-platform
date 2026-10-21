import { cookies } from 'next/headers';
import {
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_VIEWPORT_COOKIE_NAME,
  sidebarPreferences,
  type SidebarPreferences,
} from '@gold/ui/components/sidebar-preferences';

/**
 * The sidebar layout the browser last reported — the desktop preference and the viewport class —
 * read on the server so the shell's first render already matches (no expanded-then-collapsed
 * flash on a tablet). Only authenticated shells read it, so public pages stay static.
 */
export async function readShellLayout(): Promise<SidebarPreferences> {
  const store = await cookies();
  return sidebarPreferences(store.get(SIDEBAR_COOKIE_NAME)?.value, store.get(SIDEBAR_VIEWPORT_COOKIE_NAME)?.value);
}
