import type { Db } from '@/lib/db/types';

/**
 * What a member of GOLD's staff may reach of the platform — the platform's own vocabulary, exactly
 * as `Capability` is a tenant role's. One person's set lives on their `platform_staff` row; adding a
 * permission means writing the screen, extending `platform_staff_capabilities_known`, and listing it
 * here. Never named after a job title: a salesperson at GOLD is a role in GOLD, and holds none of
 * these unless somebody wrote them onto their row.
 *
 * The scopes are deliberately coarse — one per part of the console an operator's job is split
 * along — because a permission nobody can explain in a sentence is one nobody will grant correctly.
 */
export const PLATFORM_CAPABILITIES = [
  'platform.organizations',
  'platform.catalogue',
  'platform.commercial',
  'platform.providers',
  'platform.health',
] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

export function isPlatformCapability(value: string): value is PlatformCapability {
  return (PLATFORM_CAPABILITIES as readonly string[]).includes(value);
}

export const PLATFORM_CAPABILITY_LABELS: Record<PlatformCapability, string> = {
  'platform.organizations': 'Organizations, provisioning and support',
  'platform.catalogue': 'Products, plans, meters and connectors',
  'platform.commercial': 'Pricing and billing',
  'platform.providers': 'Provider accounts and bindings',
  'platform.health': 'Overview and failures',
};

/**
 * The caller's own platform permissions, read live from their own `platform_staff` row (the one row
 * `platform_staff_self_select` shows them). Empty for anybody who is not staff — never an error, so
 * a caller can ask before knowing. A live read rather than a claim in the token, so removing a
 * permission takes effect on the next request (D45).
 */
export async function platformPermissions(db: Db): Promise<ReadonlySet<PlatformCapability>> {
  const { data } = await db.auth.getUser();
  if (!data.user) return new Set();

  const { data: row } = await db
    .from('platform_staff')
    .select('capabilities')
    .eq('user_id', data.user.id)
    .maybeSingle();

  return new Set((row?.capabilities ?? []).filter(isPlatformCapability));
}
