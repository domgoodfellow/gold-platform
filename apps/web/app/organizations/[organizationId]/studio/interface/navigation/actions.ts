'use server';

import { cookies } from 'next/headers';
import { DomainError } from '@/lib/domain/errors';
import { INTERFACE_DESIGN_CAPABILITY, NAVIGATION_LAYOUT_COOKIE, NAVIGATION_LAYOUT_MAX_AGE, type NavigationLayout } from '@/lib/interface-design';
import { requireOrganization } from '@/lib/route/organization';
import { requirePlatformCapability } from '@/lib/route/platform';

export type NavigationLayoutResult = { ok: true; layout: NavigationLayout } | { ok: false; error: string };

/**
 * Applies a sidebar arrangement to this browser only. Every caller is a member of the business it
 * names. Choosing the unified layout also needs the interface-design platform permission, in
 * GildOps' operating organization; returning to the default needs nothing more, so anybody can
 * always leave the preview. The stored value is a hint the shell re-checks on every request: it
 * never decides what anybody may open.
 */
export async function setNavigationLayoutAction(organizationId: string, layout: NavigationLayout): Promise<NavigationLayoutResult> {
  await requireOrganization(organizationId);
  const store = await cookies();
  if (layout !== 'unified') {
    store.delete(NAVIGATION_LAYOUT_COOKIE);
    return { ok: true, layout: 'contextual' };
  }
  try {
    const operating = await requirePlatformCapability(INTERFACE_DESIGN_CAPABILITY);
    if (operating !== organizationId) throw new DomainError('The navigation preview is available only inside GildOps.', 'platform.capability_denied');
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
  store.set(NAVIGATION_LAYOUT_COOKIE, 'unified', {
    path: '/',
    maxAge: NAVIGATION_LAYOUT_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  return { ok: true, layout: 'unified' };
}
