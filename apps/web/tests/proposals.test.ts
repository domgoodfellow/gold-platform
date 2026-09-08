import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BusinessShape } from '@/lib/domain/configuration/configure';
import {
  applyConfigurationProposal,
  currentConfigurationProposal,
} from '@/lib/domain/configuration/proposals';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { foundBusiness } from './helpers/founding';

/**
 * The row between the drafting and the applying (`constraints.md` D32).
 *
 * **Nothing here calls a language model, and that is not a compromise.** What D32 decides is
 * structural — where a proposal lives, who may make one, what may be changed after the fact and
 * what may never be joined — and every one of those is a fact about this database rather than
 * about anybody's judgement. A test that asked a provider for a proposal would be slow,
 * non-deterministic, chargeable, and would prove something this repository does not own.
 *
 * The sharpest assertion is the first. **A proposal holds no foreign key to what applying it
 * produced, and the absence is the enforcement** — the same claim `prices.test.ts` makes about
 * `work_item_priced_lines`, read from `pg_constraint` for the same reason: a key added later for
 * a perfectly good reason is how last month's record starts reporting this month's
 * configuration (I8).
 */

// `apps/web` itself, located the same way `adapters.test.ts` does it — there is no `src/`.
const SRC = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let alice: Tenant;
let bob: Tenant;

/** A shape with nothing in it. Enough to be a row; the policy tests never read what it says. */
const EMPTY_SHAPE = {
  typeName: 'Job',
  statuses: [],
  transitions: [],
  fields: {},
  prices: [],
  hours: [],
  roles: [],
  automations: [],
};

/**
 * A whole small business, for the tests that actually apply one.
 *
 * Its own words throughout — nothing here is a platform default, and the point of applying it is
 * that `configureBusiness` never learns which business it is holding.
 */
const WORKSHOP_SHAPE: BusinessShape = {
  typeName: 'Repair',
  statuses: ['Booked in', 'On the bench', 'Ready'],
  transitions: [
    [0, 1],
    [1, 2],
  ],
  fields: {
    work_item: [{ key: 'plate', label: 'Registration', kind: 'text', required: true }],
  },
  prices: [{ name: 'Callout', unit: 'visit', amountMinor: 4250 }],
  hours: [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '17:00' }],
  roles: [{ name: 'Mechanic', capabilities: ['work_item.transition'] }],
  automations: [],
};

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    currency: 'EUR',
  });

  return { db, userId: created.user.id, organizationId };
}

/**
 * Move this tenant's own member onto a role holding exactly `capabilities`.
 *
 * The pattern the rest of this suite uses — a founder demoting themselves — rather than
 * inventing a second person. `memberships` has no grant to service-role, deliberately, so a
 * test that manufactured a colleague would be reaching around the very axis it is testing.
 */
async function limitTo(tenant: Tenant, capabilities: string[]): Promise<void> {
  const roleId = await createRole(tenant.db, {
    organizationId: tenant.organizationId,
    name: `limited-${randomUUID().slice(0, 8)}`,
    capabilities,
  });

  const { data: membership } = await tenant.db
    .from('memberships')
    .select('id')
    .eq('organization_id', tenant.organizationId)
    .single();

  await assignRole(tenant.db, { membershipId: membership!.id, roleId });
}

async function insertProposal(
  tenant: Tenant,
  description = 'A small workshop.',
  shape: unknown = EMPTY_SHAPE,
) {
  return tenant.db
    .from('configuration_proposals')
    .insert({
      organization_id: tenant.organizationId,
      description,
      shape,
      gaps: [],
      drafted_by: 'test',
      created_by: tenant.userId,
    })
    .select('id, outcome')
    .single();
}

describe('a proposal is a row between the drafting and the applying', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('prop-alice');
    bob = await newTenant('prop-bob');
  });

  it('holds no foreign key to anything applying it produced (I8, D32)', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select c.conname, t.relname as target
           from pg_constraint c
           join pg_class s on s.oid = c.conrelid
           join pg_class t on t.oid = c.confrelid
          where c.contype = 'f'
            and s.relname = 'configuration_proposals'`,
      );

      // Two references and no more: the tenant it belongs to, and the person who asked for it.
      // Nothing to `work_item_types`, `work_item_statuses`, `price_book_items`, `roles`,
      // `field_definitions`, `operating_hours` or `automation_rules` — every one of which
      // applying a proposal creates, and any one of which would make `result` track today's
      // configuration instead of what was approved.
      expect(rows.map((row) => row.target).sort()).toEqual(['organizations', 'users']);
    } finally {
      await client.end();
    }
  });

  it('refuses a member who does not hold the capability (I16)', async () => {
    // A whole tenant of its own, because this demotes the only member it has. Capabilities that
    // are plainly not nothing, so what refuses the write is this rule rather than membership —
    // and `organization.manage` among them deliberately: it is the closest thing on the list to
    // "runs the business", and holding it must not carry drafting along with it.
    //
    // `role.manage` is in the list because the platform refuses to leave a business with nobody
    // who can manage roles, which is a different invariant getting in the way of testing this
    // one. It makes the assertion stronger rather than weaker: this member can hand out
    // authority and still cannot ask for a proposal.
    const carol = await newTenant('prop-carol');
    await limitTo(carol, ['role.manage', 'organization.manage', 'work_item.create']);

    const { error } = await insertProposal(carol);

    expect(error).not.toBeNull();
  });

  it('lets a member who holds it ask, and records who asked', async () => {
    const { data, error } = await insertProposal(alice);

    expect(error).toBeNull();
    expect(data?.outcome).toBe('draft');
  });

  it('freezes a proposal once it is no longer a draft (D32)', async () => {
    const { data: created } = await insertProposal(alice, 'A workshop that will be applied.');
    const id = created!.id;

    // Applying is the next slice; what matters here is the policy, so the outcome is set
    // directly. This is the write the apply flow will make.
    const { error: applyError } = await alice.db
      .from('configuration_proposals')
      .update({ outcome: 'applied', applied_at: new Date().toISOString(), result: {} })
      .eq('id', id);
    expect(applyError).toBeNull();

    // The update policy matches drafts only, so this now matches no row at all — which is a
    // silent no-op in PostgREST rather than an error. The guarantee is that the row did not
    // change, so that is what is asserted.
    await alice.db
      .from('configuration_proposals')
      .update({ description: 'Something else entirely.' })
      .eq('id', id);

    const { data: after } = await alice.db
      .from('configuration_proposals')
      .select('description, outcome')
      .eq('id', id)
      .single();

    expect(after?.outcome).toBe('applied');
    expect(after?.description).toBe('A workshop that will be applied.');
  });

  it('keeps one business’s proposals out of another’s (I2)', async () => {
    await insertProposal(alice, 'Alice’s own description.');

    const { data } = await bob.db
      .from('configuration_proposals')
      .select('id, description')
      .eq('organization_id', alice.organizationId);

    // Not an error and not a refusal — the rows simply are not there, which is what RLS keyed
    // to the tenant means.
    expect(data).toEqual([]);
  });

  it('gives the drafting capability no database handle at all (I14, D32)', () => {
    // **The claim D32 rests on, asserted structurally because it is a structural claim.** I14
    // says an AI reaches business state only through domain tools that validate and check
    // permissions; on this path it reaches business state through nothing, because there is
    // nothing for it to reach with. That is a stronger guarantee than a permitted tool, and it
    // is worth exactly as much as it is hard to undo by accident — so this fails on the import
    // rather than on the write.
    //
    // What is deliberately allowed: importing the domain's own constant lists and types.
    // `anthropic.ts` builds its schema from `CAPABILITIES`, `FIELD_KINDS` and `TRIGGER_EVENTS`
    // so it cannot fall out of step with them. Reading what the platform supports is not
    // reaching business state; holding a client that could write it is.
    const dir = join(SRC, 'lib', 'adapters', 'drafting');
    const offenders = readdirSync(dir)
      .filter((entry) => /\.ts$/.test(entry))
      .map((entry) => ({ entry, text: readFileSync(join(dir, entry), 'utf8') }))
      .filter(
        (file) =>
          /from\s+'@\/lib\/db/.test(file.text) || /from\s+'@supabase\//.test(file.text),
      );

    expect(offenders.map((file) => file.entry)).toEqual([]);
  });

  it('applies through configureBusiness and records what it produced', async () => {
    const dave = await newTenant('prop-dave');
    await insertProposal(dave, 'A workshop, described.', WORKSHOP_SHAPE);

    const draft = await currentConfigurationProposal(dave.db, {
      organizationId: dave.organizationId,
    });
    const applied = await applyConfigurationProposal(dave.db, {
      organizationId: dave.organizationId,
      proposalId: draft!.id,
    });

    expect(applied.outcome).toBe('applied');
    expect(applied.detail).toBeNull();
    expect(applied.appliedAt).not.toBeNull();

    // The business is configured, in its own words, by the same function `milestone-m3.test.ts`
    // drives — there is no second configuration path and this is the proof there is not.
    const types = await listWorkItemTypes(dave.db, { organizationId: dave.organizationId });
    expect(types.map((type) => type.name)).toContain('Repair');

    const prices = await listPriceBookItems(dave.db, { organizationId: dave.organizationId });
    expect(prices.map((item) => item.name)).toContain('Callout');

    // Ids, snapshotted. Nothing joins to them (I8) — the assertion above reads the live
    // configuration, and this one reads the record of what was approved.
    const result = applied.result as { typeId: string; statusIds: string[] };
    expect(typeof result.typeId).toBe('string');
    expect(result.statusIds).toHaveLength(WORKSHOP_SHAPE.statuses.length);
  });

  it('is refused by the policy of whatever step the person may not take (D32)', async () => {
    const erin = await newTenant('prop-erin');
    await insertProposal(erin, 'A workshop with prices.', WORKSHOP_SHAPE);

    // **Everything except pricing.** Applying adds no capability of its own, so what refuses a
    // proposal is the capability its contents need — here `price_book_items_insert` calling
    // `app.has_capability`, and nothing in the flow. Steps before pricing succeed, which is what
    // makes the partial state real rather than hypothetical.
    await limitTo(
      erin,
      CAPABILITIES.filter((capability) => capability !== 'price.manage'),
    );

    const draft = await currentConfigurationProposal(erin.db, {
      organizationId: erin.organizationId,
    });
    const failed = await applyConfigurationProposal(erin.db, {
      organizationId: erin.organizationId,
      proposalId: draft!.id,
    });

    expect(failed.outcome).toBe('failed');
    // The domain layer's own words, carried onto the row rather than paraphrased (I25's shape).
    expect(failed.detail).toContain('prices');

    // What landed before it stopped, read back — which is what "edit the remainder and apply
    // again" is done against.
    const observed = failed.result as { workItemTypes: string[]; priceBookItems: number };
    expect(observed.workItemTypes).toContain('Repair');
    expect(observed.priceBookItems).toBe(0);

    // And the business really is part-way configured. Nothing was rolled back, because rolling
    // back would mean putting the order of those steps in the database.
    const types = await listWorkItemTypes(erin.db, { organizationId: erin.organizationId });
    expect(types.map((type) => type.name)).toContain('Repair');
  });

  it('refuses to apply anything that is no longer a draft', async () => {
    const frank = await newTenant('prop-frank');
    await insertProposal(frank, 'Applied once already.', WORKSHOP_SHAPE);

    const draft = await currentConfigurationProposal(frank.db, {
      organizationId: frank.organizationId,
    });
    await applyConfigurationProposal(frank.db, {
      organizationId: frank.organizationId,
      proposalId: draft!.id,
    });

    // Re-applying the same row would run the whole sequence again against a business that
    // already has it. The row is frozen by its policy and the domain layer says so first.
    await expect(
      applyConfigurationProposal(frank.db, {
        organizationId: frank.organizationId,
        proposalId: draft!.id,
      }),
    ).rejects.toMatchObject({ code: 'proposals.not_a_draft' });
  });

  it('cannot be deleted, because a proposal turned down is still a decision', async () => {
    const { data: created } = await insertProposal(alice, 'A description worth keeping.');
    const id = created!.id;

    await alice.db.from('configuration_proposals').delete().eq('id', id);

    const { data: after } = await alice.db
      .from('configuration_proposals')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    expect(after?.id).toBe(id);
  });
});
