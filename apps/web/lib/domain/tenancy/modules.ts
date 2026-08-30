import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { MODULES, isModuleKey, type ModuleKey } from '@/lib/navigation';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business has switched on.
 *
 * **A module is what a tenant enables, is billed for, and sees in their navigation** — a row,
 * never a directory (`constraints.md` D25). This is the mechanism M3 was supposed to ship and
 * removed by applying the *engine* bar to a question that is not about code; `roadmap.md` M3
 * records that, and D21 has been pricing partial adoption against it ever since.
 *
 * **It is not authorization and must never become it.** Nothing here is consulted by any RLS
 * policy, and no policy may start consulting it. A member who lacks `field.manage` still sees
 * that fields exist and is told why the form is not theirs (I12) — hiding a screen because of a
 * *role* is the shape that invariant exists to refuse. A module the business has not enabled is
 * a different fact: it is not part of that business, so there is nothing to explain. The two
 * look identical on screen and are opposite underneath.
 */

export type OrganizationModule = {
  key: ModuleKey;
  label: string;
  description: string;
  enabledAt: string;
};

/**
 * Which modules this business has on.
 *
 * Returns keys the platform still recognises. A row naming a key this version has dropped is
 * skipped rather than rendered: `organization_modules` is a tenant's data and outlives any
 * particular list of areas, so the read is where the two are reconciled.
 */
export async function listEnabledModules(
  db: Db,
  input: { organizationId: string },
): Promise<Set<ModuleKey>> {
  const { data, error } = await db
    .from('organization_modules')
    .select('module_key')
    .eq('organization_id', input.organizationId);

  if (error) {
    throw new DomainError(error.message, 'modules.list_failed');
  }

  return new Set((data ?? []).map((row) => row.module_key).filter(isModuleKey));
}

/** Every module, with whether this business has it on. The settings screen's whole answer. */
export async function listModuleSettings(
  db: Db,
  input: { organizationId: string },
): Promise<{ module: (typeof MODULES)[number]; enabledAt: string | null }[]> {
  const { data, error } = await db
    .from('organization_modules')
    .select('module_key, enabled_at')
    .eq('organization_id', input.organizationId);

  if (error) {
    throw new DomainError(error.message, 'modules.list_failed');
  }

  const on = new Map((data ?? []).map((row) => [row.module_key, row.enabled_at]));

  return MODULES.map((module) => ({ module, enabledAt: on.get(module.key) ?? null }));
}

/**
 * Switch a module on or off.
 *
 * **Off is a deleted row rather than a false flag**, so there is no third state in which a row
 * says `false` and something reads it as enablement. Switching back on writes a fresh
 * `enabled_at`, which is the figure a billing question actually needs.
 *
 * **Turning a module off never deletes anything it produced.** A business that stops offering
 * public booking keeps every job somebody booked; the page goes away, the history does not.
 * That is the same reasoning as I8 one level up — configuration changes what happens next, not
 * what already happened.
 */
export async function setModuleEnabled(
  db: Db,
  input: { organizationId: string; key: string; enabled: boolean },
): Promise<void> {
  const actor = await requireActor(db);

  if (!isModuleKey(input.key)) {
    throw new DomainError('This platform has no such module.', 'modules.unknown');
  }

  // **There is no refusal here any more, and its absence is the fix.** This function used to
  // reject switching off `work`, `scheduling`, `customers` or `billing` as "the operational
  // core" — which was the kernel misfiled as four required modules, and the reason module
  // enablement could not change one line of the navigation. The kernel is now simply not in
  // `MODULES`, so there is nothing to refuse: everything a business can switch on, it can
  // switch off. See `navigation.ts` for the full record.

  // A plain insert, not an upsert. There is no update policy on the table and there should
  // not be one: off is a deleted row, so enabling always writes a fresh one — an upsert would
  // have needed `update` granted for a path that can never be taken, and PostgREST refuses it
  // whether or not the conflict happens.
  const { data, error } = input.enabled
    ? await db.from('organization_modules').insert({
        organization_id: input.organizationId,
        module_key: input.key,
        enabled_by: actor.id,
      })
    : await db
        .from('organization_modules')
        .delete()
        .eq('organization_id', input.organizationId)
        .eq('module_key', input.key)
        // **Returned rows, because a refused delete is not an error.** An RLS `delete` whose
        // policy excludes the row matches nothing and reports success, so a role without
        // `organization.manage` was being told a module had been switched off while it stayed
        // on. See the check below.
        .select('module_key');

  // Already on. Switching on something that is on is not a failure, and reporting one would
  // make a double-click look like a problem.
  if (error?.code === '23505') return;

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'Your role cannot change what this business has switched on.',
        'modules.forbidden',
      );
    }
    throw new DomainError(error.message, 'modules.update_failed');
  }

  if (!input.enabled && (data ?? []).length === 0) {
    const stillOn = await listEnabledModules(db, { organizationId: input.organizationId });
    // Still on after a delete that reported success: the policy refused it. Switching off
    // something already off is not a failure and falls through.
    if (stillOn.has(input.key)) {
      throw new DomainError(
        'Your role cannot change what this business has switched on.',
        'modules.forbidden',
      );
    }
  }
}
