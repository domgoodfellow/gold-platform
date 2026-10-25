import type { Db } from '@/lib/db/types';
import type { Json } from '@/lib/db/database.types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { canonicalLayout, layoutProblems, normalizeLayout, type DashboardLayout, type WidgetDefinition } from '@/lib/dashboard-layout';

/**
 * One person's arrangement of one workspace Dashboard in one organization
 * (`dashboard_layout_preferences`). Presentation only: it never decides what a person may read,
 * and it is neither an organization report dashboard nor personal appearance. RLS limits every
 * row to its own person in an organization they belong to; this module adds strict validation
 * against the workspace's widget registry and a revision check so concurrent saves never silently
 * overwrite each other.
 */
export type DashboardWorkspace = 'finance';
export type StoredDashboardLayout = { layout: DashboardLayout; revision: number; customized: boolean };

export async function readDashboardLayout(db: Db, input: { organizationId: string; workspace: DashboardWorkspace; registry: readonly WidgetDefinition[] }): Promise<StoredDashboardLayout> {
  const actor = await requireActor(db);
  const { data, error } = await db.from('dashboard_layout_preferences').select('layout, revision')
    .eq('user_id', actor.id).eq('organization_id', input.organizationId).eq('workspace', input.workspace).maybeSingle();
  if (error) throw new DomainError('Your dashboard layout could not be loaded.', 'dashboard_layout.read_failed');
  return data ? { layout: normalizeLayout(input.registry, data.layout), revision: data.revision, customized: true } : { layout: normalizeLayout(input.registry, null), revision: 0, customized: false };
}

/**
 * Saves a complete layout. `expectedRevision` is the revision the editor opened (0 when none was
 * stored); a mismatch means another tab or device saved first, and is refused rather than merged.
 */
export async function saveDashboardLayout(db: Db, input: { organizationId: string; workspace: DashboardWorkspace; registry: readonly WidgetDefinition[]; layout: unknown; expectedRevision: number }): Promise<number> {
  const actor = await requireActor(db);
  const problems = layoutProblems(input.registry, input.layout);
  if (problems.length) throw new DomainError(`This layout cannot be saved: ${problems.join(' ')}`, 'dashboard_layout.invalid');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new DomainError('This layout cannot be saved.', 'dashboard_layout.revision_invalid');
  const layout = canonicalLayout(input.layout as DashboardLayout) as unknown as Json;
  const conflict = new DomainError('This dashboard was changed in another window. Reload to see the latest layout, then customize again.', 'dashboard_layout.conflict');
  if (input.expectedRevision === 0) {
    const { error } = await db.from('dashboard_layout_preferences').insert({ user_id: actor.id, organization_id: input.organizationId, workspace: input.workspace, layout, revision: 1 });
    if (error?.code === '23505') throw conflict;
    if (error?.code === '42501') throw new DomainError('You cannot customize this dashboard here.', 'dashboard_layout.forbidden');
    if (error) throw new DomainError('Your dashboard layout could not be saved.', 'dashboard_layout.save_failed');
    return 1;
  }
  const next = input.expectedRevision + 1;
  const { data, error } = await db.from('dashboard_layout_preferences').update({ layout, revision: next, updated_at: new Date().toISOString() })
    .eq('user_id', actor.id).eq('organization_id', input.organizationId).eq('workspace', input.workspace).eq('revision', input.expectedRevision).select('revision');
  if (error) throw new DomainError('Your dashboard layout could not be saved.', 'dashboard_layout.save_failed');
  if (!data?.length) throw conflict;
  return next;
}

/** Back to the product default: the override is removed, not overwritten with a copy of today's default. */
export async function resetDashboardLayout(db: Db, input: { organizationId: string; workspace: DashboardWorkspace }): Promise<void> {
  const actor = await requireActor(db);
  const { error } = await db.from('dashboard_layout_preferences').delete().eq('user_id', actor.id).eq('organization_id', input.organizationId).eq('workspace', input.workspace);
  if (error) throw new DomainError('Your dashboard layout could not be reset.', 'dashboard_layout.reset_failed');
}
