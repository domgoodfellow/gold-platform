import { paymentProvider } from '@/lib/adapters/payments';
import type { Db } from '@/lib/db/types';
import { getPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { DomainError } from '@/lib/domain/errors';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { MODULES, isModuleKey, type ModuleKey } from '@/lib/navigation';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';

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

/**
 * What a business still has to do before a module it has switched on does anything.
 *
 * **This is the second half of D31 and the half with the reasoning in it.** The first half is
 * a link — every module names where it is configured, and the settings screen renders it. But
 * a link on its own still lets a business believe it is finished: card payments switched on,
 * a link to *Getting paid*, and no account connected behind it. So a module that is on is also
 * asked whether it can actually do the thing it was switched on for, and the answer is a
 * sentence an operator can act on.
 *
 * **It answers only for modules that are on**, because a module a business has not enabled is
 * not part of that business — there is nobody to tell anything to, and asking would be four
 * queries for a screen that shows nothing. That is the same distinction the navigation draws
 * between a module and a capability: a role that cannot price is told why, a module nobody
 * bought is simply absent (I12).
 *
 * **The sentences describe application state, and that is the one thing the platform is
 * allowed to say.** `constraints.md` forbids the platform putting words in a tenant's mouth —
 * a tagline, a public claim, a message to a customer. None of that is here. "Nothing is priced
 * yet" is a fact about this database, in the platform's own voice, on the platform's own
 * screen.
 */
export async function outstandingModuleSetup(
  db: Db,
  input: { organizationId: string; enabled: ReadonlySet<ModuleKey> },
): Promise<Map<ModuleKey, string>> {
  const outstanding = new Map<ModuleKey, string>();

  // **A module that needs another one and does not have it is the first thing to say**, before
  // anything about that module's own configuration — there is no point telling a business to
  // write a weather rule when it has nowhere to write one. Checked from `MODULES` rather than
  // from the database, because which module needs which is a fact about this platform.
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

  // Assets and the customer portal are deliberately absent from everything below, and their
  // absence is an answer rather than an omission. An asset is a record a business keeps, not a
  // setting it fills in; a portal invitation is sent to one customer from that customer's own
  // page. Neither has a business-wide thing left undone, so neither can ever be outstanding.

  if (input.enabled.has('billing') && !outstanding.has('billing')) {
    const prices = await listPriceBookItems(db, { organizationId: input.organizationId });
    if (prices.length === 0) {
      outstanding.set('billing', 'Nothing is priced yet, so a job cannot be quoted.');
    }
  }

  if (input.enabled.has('booking') && !outstanding.has('booking')) {
    const organization = await getOrganization(db, input.organizationId);

    // Two conditions and one sentence, most-blocking first: an address with nothing published
    // is a page that answers for nobody, and something published with no address is a page
    // nobody can reach. Reporting both at once would be a list where an operator needs a step.
    if (!organization?.slug) {
      outstanding.set('booking', 'No public address yet, so there is no page to reach.');
    } else {
      // Read directly rather than through `listWorkItemTypes`, which answers a different
      // question and deliberately returns no booking columns. What "bookable" means is a
      // published status and a duration, and a constraint keeps the pair complete — so one
      // non-null status is the whole test (see `20260829000003_external_actor.sql`).
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
          // **This sentence used to end "and no screen here can publish one", which was the
          // debt rather than the state.** `setTypeBookable` had no route for two milestones, so
          // publishing needed database access on a platform whose criterion is that nobody at
          // the business has been given any. It now names where to go, which is what D31 asks a
          // module to do for every one of its inputs.
          'No kind of work is published to this page yet. Publish one on the Work screen, under the kind of work you want to take bookings for.',
        );
      }
    }
  }

  if (input.enabled.has('card_payments') && !outstanding.has('card_payments')) {
    const provider = await paymentProvider();

    if (!provider) {
      // **The case that used to render nothing at all.** A deployment with no processor keys
      // hid the whole section, so a business could switch card payments on and find an empty
      // page. It is not this business's fault and not something it can fix, which is exactly
      // why it has to be said rather than hidden.
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

  return outstanding;
}
