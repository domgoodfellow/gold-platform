import { paymentProvider } from '@/lib/adapters/payments';
import type { Db } from '@/lib/db/types';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { DomainError } from '@/lib/domain/errors';
import { draftingProvider } from '@/lib/adapters/drafting';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { MODULES, isModuleKey, type ModuleKey } from '@/lib/navigation';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';

/**
 * What a business has switched on — a row, never a directory (D25). Not authorization and must
 * never become it: no RLS policy consults this. A role that lacks a capability is told why
 * (I12); a module the business hasn't enabled is simply absent, because it isn't part of that
 * business.
 */

export type OrganizationModule = {
  key: ModuleKey;
  label: string;
  description: string;
  enabledAt: string;
};

/**
 * What a business **wants** — read straight off `organization_modules`, unaffected by whether
 * anyone has paid for it. What operational logic needs to ask (is this switch on, so its own
 * setup can be checked; did a delete actually remove the row) — never what should render, which
 * is `listUsableModules` below. Rows naming a key this version has dropped are skipped —
 * `organization_modules` outlives any particular list of areas.
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

/**
 * What a business wants **and** has currently paid for (D41) — the wanted∩paid intersection,
 * computed by `public.usable_modules`. This is what a screen or a presentation-level gate should
 * ask: D41's "screens hidden, nothing deleted" is a rendering rule, not an operational one, and
 * `listEnabledModules` above still answers the operational question unchanged.
 */
export async function listUsableModules(
  db: Db,
  input: { organizationId: string },
): Promise<Set<ModuleKey>> {
  const { data, error } = await db.rpc('usable_modules', {
    p_organization_id: input.organizationId,
  });

  if (error) {
    throw new DomainError(error.message, 'modules.list_failed');
  }

  return new Set((data ?? []).filter(isModuleKey));
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
 * Switch a module on or off. Off is a deleted row, not a false flag, so re-enabling always
 * writes a fresh `enabled_at`. Turning a module off never deletes anything it produced — the
 * history stays even after the page goes away (I8's reasoning one level up).
 */
export async function setModuleEnabled(
  db: Db,
  input: { organizationId: string; key: string; enabled: boolean },
): Promise<void> {
  const actor = await requireActor(db);

  if (!isModuleKey(input.key)) {
    throw new DomainError('This platform has no such module.', 'modules.unknown');
  }

  // A plain insert, not an upsert — there's no update policy on the table, since off is always
  // a deleted row.
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
        // Returned rows, because a refused RLS delete matches nothing and reports success.
        .select('module_key');

  // Already on. Switching on something that is on is not a failure.
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
    // Still on after a delete that reported success: the policy refused it.
    if (stillOn.has(input.key)) {
      throw new DomainError(
        'Your role cannot change what this business has switched on.',
        'modules.forbidden',
      );
    }
  }
}

/**
 * The modules `outstandingModuleSetup` can say something about even when nothing is outstanding —
 * the ones with a real check of their own below. Setup shows these as complete when they pass;
 * every other module has nothing business-wide to finish and so is never a setup area (a note
 * that a dependency is missing is reported for any module regardless of this list).
 */
export const MODULES_WITH_READINESS_CHECK: ReadonlySet<ModuleKey> = new Set<ModuleKey>([
  'billing',
  'booking',
  'card_payments',
  'reception',
]);

/**
 * What a business still has to do before a module it has switched on does anything (D31). A
 * link alone still lets a business believe it's finished — card payments on, nothing connected
 * behind it — so an enabled module is also checked against what it actually needs to work.
 * Answers only for modules that are on; describes application state only, never a claim on the
 * tenant's behalf.
 */
export async function outstandingModuleSetup(
  db: Db,
  input: { organizationId: string; enabled: ReadonlySet<ModuleKey> },
): Promise<Map<ModuleKey, string>> {
  const outstanding = new Map<ModuleKey, string>();

  // A module needing another one it doesn't have is the first thing to say.
  for (const sold of MODULES) {
    if (!input.enabled.has(sold.key)) continue;
    const needs = 'requires' in sold ? (sold.requires as ModuleKey | undefined) : undefined;
    if (needs && !input.enabled.has(needs)) {
      const label = MODULES.find((entry) => entry.key === needs)?.label ?? needs;
      outstanding.set(
        sold.key,
        `This does nothing until ${label} is switched on as well — that is where it is set up.`,
      );
    }
  }

  // Assets and the customer portal have nothing business-wide left undone, so neither appears below.

  if (input.enabled.has('billing') && !outstanding.has('billing')) {
    const prices = await listPriceBookItems(db, { organizationId: input.organizationId });
    if (prices.length === 0) {
      outstanding.set('billing', 'Nothing is priced yet, so a job cannot be quoted.');
    }
  }

  if (input.enabled.has('booking') && !outstanding.has('booking')) {
    const organization = await getOrganization(db, input.organizationId);

    if (!organization?.slug) {
      outstanding.set('booking', 'No public address yet, so there is no page to reach.');
    } else {
      // What "bookable" means is a published status and a duration, kept complete by a
      // constraint — so one non-null status is the whole test.
      const { data, error } = await db
        .from('work_item_types')
        .select('id')
        .eq('organization_id', input.organizationId)
        .not('booking_status_id', 'is', null)
        .limit(1);

      if (error) {
        throw new DomainError(error.message, 'modules.readiness_failed');
      }

      if ((data ?? []).length === 0) {
        outstanding.set(
          'booking',
          'No kind of work is published to this page yet. Publish one on the Work screen, under the kind of work you want to take bookings for.',
        );
      }
    }
  }

  if (input.enabled.has('card_payments') && !outstanding.has('card_payments')) {
    const provider = await paymentProvider();

    if (!provider) {
      outstanding.set(
        'card_payments',
        'This deployment has no payment processor yet, so there is nothing to connect.',
      );
    } else {
      const account = await getPaymentAccount(db, {
        organizationId: input.organizationId,
        provider: provider.name,
      });
      if (!account) {
        outstanding.set(
          'card_payments',
          'No account is connected, so nothing can be collected by card.',
        );
      }
    }
  }

  if (input.enabled.has('drafting') && !outstanding.has('drafting')) {
    // The adapter directly, exactly as card payments asks `paymentProvider()` above. Asking
    // `proposals.ts` instead read better and closed a cycle: `configureBusiness` now switches
    // modules on, so configuration would import this file, which imported proposals, which
    // imports configuration.
    if ((await draftingProvider()) === null) {
      outstanding.set(
        'drafting',
        'This deployment cannot draft a setup, so nothing can be proposed here. Every part of it can still be filled in on the screens above.',
      );
    }
  }

  if (input.enabled.has('reception') && !outstanding.has('reception')) {
    const number = await callingNumber(db, { organizationId: input.organizationId });
    if (!number) {
      outstanding.set(
        'reception',
        'No calling number is configured yet, so nothing can ring through.',
      );
    }
  }

  return outstanding;
}
