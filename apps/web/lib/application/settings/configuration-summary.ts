import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { Organization } from '@/lib/domain/tenancy/organizations';
import { currentPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { getPlanById } from '@/lib/domain/catalogue/plans';
import type { SettingsScopeKey } from '@/lib/route/settings';

/** Compact directory facts use exact RLS-scoped counts, without loading connection credentials or provider health. */
export async function configurationSummary(db: Db, organization: Organization): Promise<Record<SettingsScopeKey, string>> {
  const [members, connections, attention, assignment] = await Promise.all([
    db.from('memberships').select('id', { count: 'exact', head: true }).eq('organization_id', organization.id),
    db.from('integration_connections').select('id', { count: 'exact', head: true }).eq('organization_id', organization.id).eq('status', 'active'),
    db.from('integration_connections').select('id', { count: 'exact', head: true }).eq('organization_id', organization.id).eq('status', 'needs_attention'),
    currentPlanAssignment(db, { organizationId: organization.id }),
  ]);
  for (const result of [members, connections, attention]) {
    if (result.error) throw new DomainError('Settings status could not be loaded.', 'settings.summary_failed');
  }
  const plan = assignment ? await getPlanById(db, assignment.planId) : null;
  return {
    organization: `${organization.name} · ${organization.timezone} · ${organization.currency ?? 'Currency unset'}`,
    account: 'Personal identity across all your organizations',
    access: `${members.count ?? 'Unknown'} members · Your role: ${organization.role}`,
    connections: `${connections.count ?? 'Unknown'} active connections${attention.count ? ` · ${attention.count} need attention` : ''}`,
    plan: plan ? `${plan.label} · View plan and usage` : 'No plan yet · View plan',
  };
}
