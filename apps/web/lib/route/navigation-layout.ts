import { cookies } from 'next/headers';
import type { PlatformCapability } from '@/lib/domain/platform/permissions';
import { NAVIGATION_LAYOUT_COOKIE, navigationLayoutFor, type NavigationLayout } from '@/lib/interface-design';

/**
 * The sidebar arrangement for this request. `permissions` are the platform permissions the shell
 * resolved for **this** organization (`loadPlatformContext`): null outside GildOps' operating
 * organization, so a stored preview never applies anywhere else. Like `readShellLayout`, only
 * authenticated shells read it.
 */
export async function readNavigationLayout(permissions: ReadonlySet<PlatformCapability> | null | undefined): Promise<NavigationLayout> {
  if (!permissions) return 'contextual';
  const store = await cookies();
  return navigationLayoutFor(store.get(NAVIGATION_LAYOUT_COOKIE)?.value, permissions);
}
