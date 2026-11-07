import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureBusiness, readBusinessSetup, type BusinessShape } from '@/lib/domain/configuration/configure';
import {
  applyConfigurationProposal,
  awaitsFirstReview,
  currentConfigurationProposal,
  deferConfigurationProposal,
  draftFromBusiness,
  draftFromTemplate,
  fitShapeToPlan,
  listIndustryTemplates,
  listManagedIndustryTemplates,
  saveBusinessAsTemplate,
  setIndustryTemplatePublished,
  reviseConfigurationProposal,
  discardConfigurationProposal,
  suggestedTemplateKey,
} from '@/lib/domain/configuration/proposals';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listForms } from '@/lib/domain/forms/forms';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { getBusinessProfile } from '@/lib/domain/tenancy/business-profile';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { ROLE_PRESETS } from '@/lib/domain/tenancy/role-presets';
import { assignRole, createRole, listRoles } from '@/lib/domain/tenancy/roles';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listResourceRequirements } from '@/lib/domain/work-items/requirements';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { createWorkItemType, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { getOrganizationIdentity, setBusinessServes } from '@/lib/domain/tenancy/identity';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { asPlatformStaff, foundBusiness, newAccountEmail } from '@/tests/support/founding';
import { BUSINESSES, demoShape } from '../../../scripts/demo/businesses';

/**
 * The row between the drafting and the applying (the draft-then-apply rule, ADR-039).
 *
 * **Nothing here calls a language model, and that is not a compromise.** What the draft-then-apply rule decides is
 * structural — where a proposal lives, who may make one, what may be changed after the fact and
 * what may never be joined — and every one of those is a fact about this database rather than
 * about anybody's judgement. A test that asked a provider for a proposal would be slow,
 * non-deterministic, chargeable, and would prove something this repository does not own.
 *
 * The sharpest assertion is the first. **A proposal holds no foreign key to what applying it
 * produced, and the absence is the enforcement** — the same claim `prices.test.ts` makes about
 * `work_item_priced_lines`, read from `pg_constraint` for the same reason: a key added later for
 * a perfectly good reason is how last month's record starts reporting this month's
 * configuration.
 */

// `apps/web` itself, located the same way `adapters.test.ts` does it — there is no `src/`.
const SRC = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
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
  schedulable: true,
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
  schedulable: true,
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

  it('holds no foreign key to anything applying it produced', async () => {
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

  it('refuses a member who does not hold the capability', async () => {
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

  it('freezes a proposal once it is no longer a draft', async () => {
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

  it('keeps one business’s proposals out of another’s', async () => {
    await insertProposal(alice, 'Alice’s own description.');

    const { data } = await bob.db
      .from('configuration_proposals')
      .select('id, description')
      .eq('organization_id', alice.organizationId);

    // Not an error and not a refusal — the rows simply are not there, which is what RLS keyed
    // to the tenant means.
    expect(data).toEqual([]);
  });

  it('gives the drafting capability no database handle at all', () => {
    // **The claim the draft-then-apply rule rests on, asserted structurally because it is a structural claim.** The AI-acts-only-through-tools rule
    // says an AI reaches business state only through domain tools that validate and check
    // permissions; on this path it reaches business state through nothing, because there is
    // nothing for it to reach with. That is a stronger guarantee than a permitted tool, and it
    // is worth exactly as much as it is hard to undo by accident — so this fails on the import
    // rather than on the write.
    //
    // What is deliberately allowed: importing the domain's own constant lists and types.
    // `gold-api.ts` builds its schema from `CAPABILITIES`, `FIELD_KINDS` and `TRIGGER_EVENTS`
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

    // Ids, snapshotted. Nothing joins to them — the assertion above reads the live
    // configuration, and this one reads the record of what was approved.
    const result = applied.result as { typeId: string; statusIds: string[] };
    expect(typeof result.typeId).toBe('string');
    expect(result.statusIds).toHaveLength(WORKSHOP_SHAPE.statuses!.length);
  });

  it('refuses a forged organization even when the actor owns both businesses', async () => {
    const tenant = await newTenant('proposal-scope');
    const other = await createOrganization(tenant.db, { name: 'Separate business', displayName: 'Owner', timezone: 'UTC', currency: 'EUR' });
    const { data, error } = await insertProposal(tenant, 'Bound to its original business.', WORKSHOP_SHAPE);
    if (error) throw error;
    await expect(applyConfigurationProposal(tenant.db, { organizationId: other, proposalId: data!.id }))
      .rejects.toMatchObject({ code: 'proposals.not_found' });
    expect(await listWorkItemTypes(tenant.db, { organizationId: other })).toEqual([]);
    expect((await currentConfigurationProposal(tenant.db, { organizationId: tenant.organizationId }))?.outcome).toBe('draft');
    await expect(reviseConfigurationProposal(tenant.db, { organizationId: other, proposalId: data!.id, shape: EMPTY_SHAPE })).rejects.toMatchObject({ code: 'proposals.not_a_draft' });
    await expect(discardConfigurationProposal(tenant.db, { organizationId: other, proposalId: data!.id })).rejects.toMatchObject({ code: 'proposals.not_a_draft' });
    expect((await currentConfigurationProposal(tenant.db, { organizationId: tenant.organizationId }))?.outcome).toBe('draft');
  });

  it('rejects malformed nested data and unavailable features before configuration writes', async () => {
    const tenant = await newTenant('proposal-untrusted');
    const { data, error } = await insertProposal(tenant, 'Reviewed setup.', WORKSHOP_SHAPE);
    if (error) throw error;
    await expect(reviseConfigurationProposal(tenant.db, { organizationId: tenant.organizationId, proposalId: data!.id, shape: { ...WORKSHOP_SHAPE, roles: [null] } as unknown as BusinessShape }))
      .rejects.toMatchObject({ code: 'configuration.shape_invalid' });
    await reviseConfigurationProposal(tenant.db, { organizationId: tenant.organizationId, proposalId: data!.id, shape: { ...WORKSHOP_SHAPE, featureKeys: ['invented_feature'] } });
    const applied = await applyConfigurationProposal(tenant.db, { organizationId: tenant.organizationId, proposalId: data!.id });
    expect(applied.outcome).toBe('failed');
    expect(await listWorkItemTypes(tenant.db, { organizationId: tenant.organizationId })).toEqual([]);
  });

  it('claims a draft once when two Apply requests race', async () => {
    const tenant = await newTenant('proposal-race');
    const { data, error } = await insertProposal(tenant, 'Apply exactly once.', WORKSHOP_SHAPE);
    if (error) throw error;
    const input = { organizationId: tenant.organizationId, proposalId: data!.id };
    const results = await Promise.allSettled([
      applyConfigurationProposal(tenant.db, input),
      applyConfigurationProposal(tenant.db, input),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await listWorkItemTypes(tenant.db, { organizationId: tenant.organizationId })).filter((type) => type.name === 'Repair')).toHaveLength(1);
  });

  it('freezes a claimed shape and refuses discard or replay', async () => {
    const tenant = await newTenant('proposal-frozen');
    const { data, error } = await insertProposal(tenant, 'Claimed setup.', WORKSHOP_SHAPE);
    if (error) throw error;
    expect((await tenant.db.from('configuration_proposals').update({ outcome: 'applying' }).eq('id', data!.id)).error).toBeNull();
    for (const edit of [{ shape: {} }, { outcome: 'draft' }, { outcome: 'discarded' }]) {
      const refused = await tenant.db.from('configuration_proposals').update(edit).eq('id', data!.id);
      expect(refused.error?.code).toBe('55000');
    }
    await expect(applyConfigurationProposal(tenant.db, { organizationId: tenant.organizationId, proposalId: data!.id })).rejects.toMatchObject({ code: 'proposals.not_a_draft' });
    expect(await listWorkItemTypes(tenant.db, { organizationId: tenant.organizationId })).toEqual([]);
  });

  it('is refused by the policy of whatever step the person may not take', async () => {
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
    // The domain layer's own words, carried onto the row rather than paraphrased (the no-paraphrase rule's shape).
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

/**
 * Work Order 2: a business starts from an industry template, and the owner always confirms it
 * on the review screen. Whichever door the template arrives through — the owner choosing it,
 * staff choosing it when provisioning, or a sales hand-off — it is a draft until applied.
 */
describe('a business can start from an industry template', () => {
  beforeAll(() => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  });

  it('publishes three templates whose roles are copies of the role presets', async () => {
    const reader = await newTenant('tpl-reader');
    const templates = await listIndustryTemplates(reader.db);
    // Staff may publish more after these (Work Order 3), so the seeded three are checked as the first three.
    expect(templates.slice(0, 3).map((template) => template.key)).toEqual(['answering_service', 'rental_field_service', 'appointment_clinic']);
    const answering = templates[0];
    for (const role of answering.shape.roles) {
      const preset = ROLE_PRESETS.find((candidate) => candidate.label === role.name);
      expect(preset, `${role.name} names a role preset`).toBeDefined();
      expect([...role.capabilities].sort()).toEqual([...preset!.capabilities].sort());
    }
    expect(answering.shape.wording?.nouns).toMatchObject({ work: { singular: 'Call' }, customer: { singular: 'Client' } });
    expect(suggestedTemplateKey(templates, 'health and wellness')).toBe('appointment_clinic');
    expect(suggestedTemplateKey(templates, 'Answering service')).toBe('answering_service');
    expect(suggestedTemplateKey(templates, 'Bakery')).toBeNull();
  });

  it('refuses an organization member writing to the catalogue, and hides unpublished templates', async () => {
    const member = await newTenant('tpl-writer');
    const insert = await member.db.from('industry_templates').insert({ key: `x_${randomUUID().slice(0, 6)}`, name: 'Mine', category: 'Mine', description: 'Mine', shape: {} });
    expect(insert.error?.code).toBe('42501');
    const update = await member.db.from('industry_templates').update({ name: 'Renamed' }).eq('key', 'answering_service').select('key');
    expect(update.data ?? []).toEqual([]);
  });

  it('opens a template as a draft, applies it, records it, and finishes after a forced failure with nothing twice', async () => {
    const owner = await newTenant('tpl-answering');
    const draft = await draftFromTemplate(owner.db, { organizationId: owner.organizationId, templateKey: 'answering_service' });
    expect(draft).toMatchObject({ origin: 'template', templateKey: 'answering_service', outcome: 'draft', description: 'Answering service' });
    // A founded business's plan does not include Reception, so the draft leaves it out rather than failing later.
    expect(draft.shape.modules ?? []).not.toContain('reception');
    await expect(draftFromTemplate(owner.db, { organizationId: owner.organizationId, templateKey: 'appointment_clinic' }))
      .rejects.toMatchObject({ code: 'proposals.draft_waiting' });

    // Force a failure part-way: prices are applied after work types, stages, fields and hours.
    await reviseConfigurationProposal(owner.db, {
      organizationId: owner.organizationId,
      proposalId: draft.id,
      shape: { ...draft.shape, prices: [{ name: 'Per call', unit: 'call', amountMinor: -1 }] },
    });
    const failed = await applyConfigurationProposal(owner.db, { organizationId: owner.organizationId, proposalId: draft.id });
    expect(failed.outcome).toBe('failed');
    expect(failed.detail).toContain('negative');
    expect(failed.retryId).toBeTruthy();

    // The same document is waiting again, still saying where it came from.
    const retry = await currentConfigurationProposal(owner.db, { organizationId: owner.organizationId });
    expect(retry).toMatchObject({ id: failed.retryId, origin: 'template', templateKey: 'answering_service' });
    await reviseConfigurationProposal(owner.db, {
      organizationId: owner.organizationId,
      proposalId: retry!.id,
      shape: { ...retry!.shape, prices: [{ name: 'Per call', unit: 'call', amountMinor: 150 }] },
    });
    const applied = await applyConfigurationProposal(owner.db, { organizationId: owner.organizationId, proposalId: retry!.id });
    expect(applied.outcome).toBe('applied');

    const organizationId = owner.organizationId;
    const types = await listWorkItemTypes(owner.db, { organizationId });
    expect(types.map((type) => type.name).sort()).toEqual(['Callback', 'Inbound call']);
    const callback = types.find((type) => type.name === 'Callback')!;
    expect(callback.schedulable).toBe(true);
    const stages = await listWorkItemStatuses(owner.db, { organizationId, typeId: callback.id });
    expect(stages.map(({ name, marksComplete, releasesResource }) => ({ name, marksComplete, releasesResource }))).toEqual([
      { name: 'Booked', marksComplete: false, releasesResource: false },
      { name: 'Calling', marksComplete: false, releasesResource: false },
      { name: 'Done', marksComplete: true, releasesResource: true },
      { name: 'No answer', marksComplete: false, releasesResource: true },
    ]);
    expect(await listWorkItemTransitions(owner.db, { organizationId, typeId: callback.id })).toHaveLength(4);
    expect((await listTypeChecklistItems(owner.db, { organizationId, typeId: callback.id })).map((step) => step.label)).toEqual(['Check who to call back', 'Record the outcome']);
    expect(await listResourceRequirements(owner.db, { organizationId, typeId: callback.id })).toMatchObject([{ resourceClass: 'person', quantity: 1 }]);
    expect((await listRoles(owner.db, { organizationId })).map((role) => role.name).filter((name) => name !== 'Admin').sort()).toEqual(['Manager', 'Support']);
    expect(await listOperatingHours(owner.db, { organizationId })).toHaveLength(5);
    expect((await listFieldDefinitions(owner.db, { organizationId, entityType: 'customer' })).map((field) => field.key)).toEqual(['answer_as', 'cover_hours', 'call_instructions']);
    expect((await listPriceBookItems(owner.db, { organizationId })).map((price) => price.name)).toEqual(['Per call']);
    const profile = await getBusinessProfile(owner.db, organizationId);
    expect(profile?.nouns).toMatchObject({ work: { singular: 'Call', plural: 'Calls' }, customer: { singular: 'Client', plural: 'Clients' } });
    expect(profile?.navigation).toEqual(['home', 'calls', 'work', 'customers', 'schedule']);
    const forms = await listForms(owner.db, organizationId);
    expect(forms.filter((form) => form.name === 'Contact us')).toHaveLength(1);
    const { data: identity } = await owner.db.from('organization_identity').select('starting_template_key').eq('organization_id', organizationId).single();
    expect(identity?.starting_template_key).toBe('answering_service');
  });

  it('lets staff offer a template when provisioning, which waits for the owner and cannot be forged by a member', async () => {
    const staff = await asPlatformStaff();
    const ownerEmail = await newAccountEmail('tpl-provisioned');
    const organizationId = await provisionOrganization(staff, { ownerEmail, name: 'Provisioned clinic', currency: 'JPY', templateKey: 'appointment_clinic' });
    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query<{ origin: string; outcome: string; template_key: string; types: number }>(
        `select p.origin, p.outcome, p.template_key,
                (select count(*)::int from public.work_item_types t where t.organization_id = p.organization_id) as types
           from public.configuration_proposals p where p.organization_id = $1`, [organizationId]);
      // Offered, never applied: nothing is set up until the owner applies it.
      expect(rows).toEqual([{ origin: 'provisioned', outcome: 'draft', template_key: 'appointment_clinic', types: 0 }]);
    } finally {
      await pg.end();
    }
    await expect(provisionOrganization(staff, { ownerEmail, name: 'Unknown start', currency: 'EUR', templateKey: 'no_such_template' }))
      .rejects.toThrow(/no published starting template/i);

    // A member cannot write a draft that claims GildOps prepared or agreed it.
    const member = await newTenant('tpl-forger');
    const forged = await member.db.from('configuration_proposals').insert({
      organization_id: member.organizationId, description: 'Forged', shape: EMPTY_SHAPE, gaps: [], drafted_by: 'me', created_by: member.userId, origin: 'agreed',
    });
    expect(forged.error?.code).toBe('42501');
  });

  it('sets a waiting draft aside without discarding it', async () => {
    const owner = await newTenant('tpl-later');
    const draft = await draftFromTemplate(owner.db, { organizationId: owner.organizationId, templateKey: 'rental_field_service' });
    expect(awaitsFirstReview(draft)).toBe(false);
    await deferConfigurationProposal(owner.db, { organizationId: owner.organizationId, proposalId: draft.id });
    const waiting = await currentConfigurationProposal(owner.db, { organizationId: owner.organizationId });
    expect(waiting?.id).toBe(draft.id);
    expect(waiting?.deferredAt).not.toBeNull();
  });

  it('gives a kind of work made by hand three starting stages', async () => {
    const owner = await newTenant('tpl-starter');
    const typeId = await createWorkItemType(owner.db, { organizationId: owner.organizationId, name: 'Visit', schedulable: true, withStarterStages: true });
    const stages = await listWorkItemStatuses(owner.db, { organizationId: owner.organizationId, typeId });
    expect(stages.map(({ name, position, marksComplete, releasesResource }) => ({ name, position, marksComplete, releasesResource }))).toEqual([
      { name: 'Booked', position: 0, marksComplete: false, releasesResource: false },
      { name: 'In progress', position: 1, marksComplete: false, releasesResource: false },
      { name: 'Done', position: 2, marksComplete: true, releasesResource: true },
    ]);
    const moves = await listWorkItemTransitions(owner.db, { organizationId: owner.organizationId, typeId });
    const name = (id: string) => stages.find((stage) => stage.id === id)!.name;
    expect(moves.map((move) => `${name(move.fromStatusId)}→${name(move.toStatusId)}`).sort()).toEqual(['Booked→Done', 'Booked→In progress', 'In progress→Done']);
  });
});

/**
 * Work Order 3: a business's setup is read back out (`readBusinessSetup`), and what is read can be
 * applied to another business to make the same setup. Copying never carries customers, jobs or
 * money, and only somebody who manages both businesses may copy. Staff who look after the catalogue
 * can save a business as an unpublished template, which owners never see until it is published.
 */
describe('a business setup can be read back, copied and saved as a template', () => {
  beforeAll(() => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  });

  /** One person who owns two businesses: one to set up, and a blank one to copy it into. */
  async function ownerOfTwo(label: string): Promise<{ db: SupabaseClient; source: string; blank: string; email: string }> {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const source = await foundBusiness({ ownerEmail: email, name: `${label} source`, currency: 'EUR' });
    const blank = await foundBusiness({ ownerEmail: email, name: `${label} copy`, currency: 'EUR' });
    const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = await db.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    return { db, source, blank, email };
  }

  /** Data a business holds that is not setup: a customer and a job for them. */
  async function addCustomerAndJob(db: SupabaseClient, organizationId: string): Promise<void> {
    const customerId = await createCustomer(db, { organizationId, name: 'A customer', email: 'customer@example.test' });
    const [type] = await listWorkItemTypes(db, { organizationId });
    const [stage] = await listWorkItemStatuses(db, { organizationId, typeId: type.id });
    await createWorkItem(db, { organizationId, title: 'A job', statusId: stage.id, customerId });
  }

  /** Read the source, copy it into the blank business, read that: the two must be the same setup. */
  async function copiesExactly(owner: Awaited<ReturnType<typeof ownerOfTwo>>): Promise<BusinessShape> {
    const before = await readBusinessSetup(owner.db, owner.source);
    const draft = await draftFromBusiness(owner.db, { organizationId: owner.blank, sourceOrganizationId: owner.source });
    expect(draft).toMatchObject({ origin: 'copied', copiedFrom: owner.source, outcome: 'draft' });
    const applied = await applyConfigurationProposal(owner.db, { organizationId: owner.blank, proposalId: draft.id });
    expect(applied.detail).toBeNull();
    expect(applied.outcome).toBe('applied');
    expect(await readBusinessSetup(owner.db, owner.blank)).toEqual(before);

    // Setup only: none of the source's customers, jobs or money came across.
    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query<{ customers: number; jobs: number; invoices: number; prices: number }>(
        `select (select count(*)::int from public.contacts where organization_id = $1) as customers,
                (select count(*)::int from public.work_items where organization_id = $1) as jobs,
                (select count(*)::int from public.invoices where organization_id = $1) as invoices,
                (select count(*)::int from public.price_book_items where organization_id = $1) as prices`, [owner.blank]);
      expect(rows[0]).toEqual({ customers: 0, jobs: 0, invoices: 0, prices: 0 });
    } finally {
      await pg.end();
    }
    return before;
  }

  for (const key of ['answering_service', 'rental_field_service', 'appointment_clinic']) {
    it(`copies a business started from the ${key} template, and nothing but its setup`, async () => {
      const owner = await ownerOfTwo(`copy-${key.slice(0, 6)}`);
      const draft = await draftFromTemplate(owner.db, { organizationId: owner.source, templateKey: key });
      expect((await applyConfigurationProposal(owner.db, { organizationId: owner.source, proposalId: draft.id })).outcome).toBe('applied');
      await addCustomerAndJob(owner.db, owner.source);
      const shape = await copiesExactly(owner);
      const template = (await listIndustryTemplates(owner.db)).find((candidate) => candidate.key === key)!;
      // What was read back is the template's setup, as applied.
      expect(shape.workTypes?.map((type) => type.name).sort()).toEqual(template.shape.workTypes!.map((type) => type.name).sort());
      expect(shape.serves).toBe(template.shape.serves);
      expect(shape.prices).toEqual([]);
    }, 120_000);
  }

  for (const business of BUSINESSES) {
    it(`copies a business set up like the ${business.name} demo, its own prices and customers staying behind`, async () => {
      const owner = await ownerOfTwo(`copy-demo-${business.template.slice(0, 6)}`);
      const { shape } = await fitShapeToPlan(owner.db, owner.source, await demoShape(owner.db, business));
      await configureBusiness(owner.db, owner.source, shape);
      await addCustomerAndJob(owner.db, owner.source);
      const read = await copiesExactly(owner);
      expect(read.workTypes?.map((type) => type.stages.map((stage) => stage.name))).toEqual(shape.workTypes?.map((type) => type.stages.map((stage) => stage.name)));
      expect(read.hours).toEqual(shape.hours);
    }, 120_000);
  }

  it('lets only somebody who manages both businesses copy, and nobody else read a setup', async () => {
    const owner = await ownerOfTwo('copy-guard');
    const draft = await draftFromTemplate(owner.db, { organizationId: owner.source, templateKey: 'rental_field_service' });
    await applyConfigurationProposal(owner.db, { organizationId: owner.source, proposalId: draft.id });
    const stranger = await newTenant('copy-stranger');

    await expect(draftFromBusiness(stranger.db, { organizationId: stranger.organizationId, sourceOrganizationId: owner.source }))
      .rejects.toMatchObject({ code: 'proposals.copy_forbidden' });
    await expect(readBusinessSetup(stranger.db, owner.source)).rejects.toMatchObject({ code: 'configuration.read_forbidden' });
    // Writing the row directly, naming a business the author does not manage, is refused too.
    const forged = await stranger.db.from('configuration_proposals').insert({
      organization_id: stranger.organizationId, description: 'Forged copy', shape: EMPTY_SHAPE, gaps: [], drafted_by: 'me',
      created_by: stranger.userId, origin: 'copied', copied_from: owner.source,
    });
    expect(forged.error?.code).toBe('42501');

    // A member without `organization.manage` cannot read their own business's setup either.
    await limitTo(stranger, CAPABILITIES.filter((capability) => capability !== 'organization.manage'));
    await expect(readBusinessSetup(stranger.db, stranger.organizationId)).rejects.toMatchObject({ code: 'configuration.read_forbidden' });
  }, 120_000);

  it('records who a business serves, from its information and from a setup', async () => {
    const owner = await newTenant('serves');
    expect((await getOrganizationIdentity(owner.db, owner.organizationId)).serves).toBeNull();
    await setBusinessServes(owner.db, { organizationId: owner.organizationId, serves: 'people' });
    expect((await getOrganizationIdentity(owner.db, owner.organizationId)).serves).toBe('people');
    const draft = await draftFromTemplate(owner.db, { organizationId: owner.organizationId, templateKey: 'answering_service' });
    expect(draft.shape.serves).toBe('companies');
    await applyConfigurationProposal(owner.db, { organizationId: owner.organizationId, proposalId: draft.id });
    expect((await getOrganizationIdentity(owner.db, owner.organizationId)).serves).toBe('companies');
  }, 120_000);

  it('saves a business as an unpublished template that owners only see once staff publish it', async () => {
    const owner = await ownerOfTwo('save-template');
    const draft = await draftFromTemplate(owner.db, { organizationId: owner.source, templateKey: 'appointment_clinic' });
    await applyConfigurationProposal(owner.db, { organizationId: owner.source, proposalId: draft.id });
    await addCustomerAndJob(owner.db, owner.source);

    // An owner is not catalogue staff.
    await expect(saveBusinessAsTemplate(owner.db, { organizationId: owner.source, name: 'Mine', description: 'Mine' }))
      .rejects.toMatchObject({ code: 'templates.forbidden' });

    const staff = await asPlatformStaff();
    const key = await saveBusinessAsTemplate(staff, { organizationId: owner.source, name: 'Saved clinic', description: 'A clinic saved by staff.' });
    try {
      const saved = (await listManagedIndustryTemplates(staff)).find((template) => template.key === key)!;
      expect(saved).toMatchObject({ name: 'Saved clinic', published: false });
      expect(saved.shape).toEqual(await readBusinessSetup(owner.db, owner.source));

      expect((await listIndustryTemplates(owner.db)).map((template) => template.key)).not.toContain(key);
      await expect(draftFromTemplate(owner.db, { organizationId: owner.blank, templateKey: key })).rejects.toMatchObject({ code: 'templates.not_found' });

      await setIndustryTemplatePublished(staff, { key, published: true });
      expect((await listIndustryTemplates(owner.db)).map((template) => template.key)).toContain(key);
      const fromSaved = await draftFromTemplate(owner.db, { organizationId: owner.blank, templateKey: key });
      expect((await applyConfigurationProposal(owner.db, { organizationId: owner.blank, proposalId: fromSaved.id })).outcome).toBe('applied');
      expect(await readBusinessSetup(owner.db, owner.blank)).toEqual(saved.shape);

      await expect(setIndustryTemplatePublished(owner.db, { key, published: false })).rejects.toMatchObject({ code: 'templates.forbidden' });
    } finally {
      // Published templates are offered to every new business on this database; this one was only for the test.
      const pg = new Client(CONNECTION);
      await pg.connect();
      await pg.query('update public.organization_identity set starting_template_key = null where starting_template_key = $1', [key]);
      await pg.query('delete from public.industry_templates where key = $1', [key]);
      await pg.end();
    }
  }, 120_000);
});
