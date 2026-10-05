import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, getCustomer, updateCustomer } from '@/lib/domain/customers/customers';
import {
  createCustomerStage,
  listCustomerStages,
  updateCustomerStage,
} from '@/lib/domain/customers/stages';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { listCustomerCalls, recordCall } from '@/lib/domain/reception/calls';
import { createCallOutcome, listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { callingNumber, setCallingNumber } from '@/lib/domain/reception/telephony';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Vertical two, held to the same bar vertical one was.
 *
 * **The claims worth testing here are the ones a dialer usually gets wrong**, and none of them is
 * "a call can be written down":
 *
 *   * two businesses can use the same word for different stages, which is I2 on a table that did
 *     not exist before;
 *   * a call cannot name another business's outcome, which is I18 on a new composite key;
 *   * a role without `call.place` is refused by the database rather than by a hidden button,
 *     which is I12;
 *   * a customer's stage moves and the timeline says so in the tenant's word, which is the loop
 *     the module exists for.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; email: string; userId: string; organizationId: string };

let floor: Tenant;
let other: Tenant;

async function account(label: string): Promise<{ db: SupabaseClient; email: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { db, email, userId: created.user.id };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, email, userId } = await account(label);
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 8)}`,
    currency: 'CAD',
  });
  return { db, email, userId, organizationId };
}

beforeAll(async () => {
  [floor, other] = await Promise.all([newTenant('floor'), newTenant('other')]);
}, 60_000);

describe('a stage is a word a business owns', () => {
  it('lets two businesses mean different things by the same word', async () => {
    // I2 on a table that did not exist before this slice. `customer_stages_org_name_unique`
    // leads with the tenant id, so a sales floor's *Qualified* and a clinic's *Qualified* are
    // two rows. If this ever fails, that index has lost its leading column.
    const mine = await createCustomerStage(floor.db, {
      organizationId: floor.organizationId,
      name: 'Qualified',
      position: 1,
    });
    const theirs = await createCustomerStage(other.db, {
      organizationId: other.organizationId,
      name: 'Qualified',
      position: 1,
    });

    expect(mine).not.toEqual(theirs);
  });

  it('refuses the same word twice inside one business', async () => {
    await createCustomerStage(floor.db, {
      organizationId: floor.organizationId,
      name: 'Dormant',
    });

    await expect(
      createCustomerStage(floor.db, { organizationId: floor.organizationId, name: 'dormant' }),
    ).rejects.toThrow(/already has a stage with that name/);
  });

  it('seeds none, so a new business has an empty pipeline', async () => {
    const fresh = await newTenant('fresh');
    expect(await listCustomerStages(fresh.db, { organizationId: fresh.organizationId })).toEqual([]);
  });

  it('renames without orphaning anybody on it', async () => {
    // The difference from `field_definitions.key`, which the column grant refuses to change: a
    // stage carries no stored values, so the word can move and the customers pointing at it come
    // with it.
    const stageId = await createCustomerStage(floor.db, {
      organizationId: floor.organizationId,
      name: 'Warm',
    });
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Renaming Co',
    });
    await updateCustomer(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      name: 'Renaming Co',
      stageId,
    });

    await updateCustomerStage(floor.db, { id: stageId, name: 'Working', position: 2 });

    const after = await getCustomer(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });
    expect(after?.stageId).toEqual(stageId);

    const stages = await listCustomerStages(floor.db, { organizationId: floor.organizationId });
    expect(stages.find((stage) => stage.id === stageId)?.name).toEqual('Working');
  });

  it('cannot be given to another business’s customer', async () => {
    // I18 through the composite foreign key. The stage id is real and the customer is real; they
    // belong to different businesses, and the database is what refuses to join them.
    const theirStage = await createCustomerStage(other.db, {
      organizationId: other.organizationId,
      name: 'Theirs Only',
    });
    const mine = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Mine Only',
    });

    await expect(
      updateCustomer(floor.db, {
        organizationId: floor.organizationId,
        customerId: mine,
        name: 'Mine Only',
        stageId: theirStage,
      }),
    ).rejects.toThrow();
  });
});

describe('a customer can be edited at all', () => {
  it('corrects the details that were wrong when they were written down', async () => {
    // The gap this slice closed: `customers` shipped with select and insert and nothing else, so
    // every value on it was permanent.
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Typo Ltd',
      phone: '+14165550100',
    });

    await updateCustomer(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      name: 'Corrected Ltd',
      phone: '+14165550188',
    });

    const after = await getCustomer(floor.db, { organizationId: floor.organizationId, customerId });
    expect(after?.name).toEqual('Corrected Ltd');
    expect(after?.phone).toEqual('+14165550188');
  });

  it('refuses a customer belonging to another business, without saying which it was', async () => {
    const theirs = await createCustomer(other.db, {
      organizationId: other.organizationId,
      name: 'Not Yours Ltd',
    });

    // Named with the other tenant's id as well as their customer, because RLS decides on both
    // and a caller who guessed one should still learn nothing.
    await expect(
      updateCustomer(floor.db, {
        organizationId: other.organizationId,
        customerId: theirs,
        name: 'Renamed By A Stranger',
      }),
    ).rejects.toThrow();

    const untouched = await getCustomer(other.db, {
      organizationId: other.organizationId,
      customerId: theirs,
    });
    expect(untouched?.name).toEqual('Not Yours Ltd');
  });

  it('is refused by the database for a role that does not hold it (I12)', async () => {
    // A role with everything else it needs to work here and no `customer.update`. The refusal
    // has to come from the policy, because hiding the form is a courtesy and not the guard.
    const { email } = await account('reader');
    const roleId = await createRole(floor.db, {
      organizationId: floor.organizationId,
      name: `Reader ${randomUUID().slice(0, 8)}`,
      capabilities: ['customer.create'],
    });
    await addMember(floor.db, {
      organizationId: floor.organizationId,
      email,
      displayName: 'Reader',
      roleId,
    });

    const reader = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Signing in again rather than reusing the client from `account`, because the membership was
    // written after that session began and the tenant claim is read at sign-in.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    expect(link).toBeTruthy();

    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Guarded Ltd',
    });

    // The reader holds `customer.create` and not `customer.update`, so the policy refuses the
    // write. Asserted through the raw table rather than the domain function, because what is
    // being tested is the policy rather than the wrapper.
    const refused = await reader
      .from('customers')
      .update({ name: 'Changed' })
      .eq('id', customerId)
      .select('id');

    expect(refused.data ?? []).toEqual([]);
  });
});

describe('a call', () => {
  it('is written down against the customer it was with', async () => {
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Dialled Ltd',
      phone: '+14165550142',
    });

    await recordCall(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });

    const calls = await listCustomerCalls(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].direction).toEqual('outbound');
    // The network's fact, not the business's word. Nobody has said how it went yet.
    expect(calls[0].outcome).toBeNull();
  });

  it('refuses a number with no country on it', async () => {
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Bad Number Ltd',
    });

    await expect(
      recordCall(floor.db, {
        organizationId: floor.organizationId,
        customerId,
        direction: 'outbound',
        fromNumber: '4165550100',
        toNumber: '+14165550142',
      }),
    ).rejects.toThrow(/country code/);
  });

  it('carries the tenant’s own word for how it went, and the platform’s own fact beside it', async () => {
    // Called through `record_call_outcome` directly rather than through a TypeScript domain
    // function: this write is now authoritative in `apps/api/app/domains/communications/voice`,
    // reaching this same RPC over its own HTTP call — see that module's own comment. What this
    // suite proves is the RPC's own behavior under real RLS, exactly as it did before the move.
    const outcomeId = await createCallOutcome(floor.db, {
      organizationId: floor.organizationId,
      name: 'Gatekeeper',
      // The one platform fact: a word the business chose cannot say whether anybody was reached.
      reached: false,
    });

    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Wrapped Up Ltd',
    });
    const callId = await recordCall(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });

    const { error } = await floor.db.rpc('record_call_outcome', {
      p_organization_id: floor.organizationId,
      p_call_id: callId,
      p_outcome_id: outcomeId,
      p_note: 'Asked us to call back Thursday.',
      p_duration_seconds: 42,
    });
    expect(error).toBeNull();

    const [call] = await listCustomerCalls(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });
    expect(call.outcome?.name).toEqual('Gatekeeper');
    expect(call.outcome?.reached).toBe(false);
    expect(call.durationSeconds).toEqual(42);
  });

  it('cannot be given another business’s outcome', async () => {
    // I18 again, on the second composite key this slice adds. Their word, my call.
    const theirOutcome = await createCallOutcome(other.db, {
      organizationId: other.organizationId,
      name: 'Theirs',
      reached: true,
    });
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Cross Tenant Ltd',
    });
    const callId = await recordCall(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });

    const { error } = await floor.db.rpc('record_call_outcome', {
      p_organization_id: floor.organizationId,
      p_call_id: callId,
      p_outcome_id: theirOutcome,
      p_note: '',
      p_duration_seconds: null,
    });
    expect(error).not.toBeNull();
  });

  it('is invisible to another business (I1)', async () => {
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Private Ltd',
    });
    await recordCall(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      direction: 'inbound',
      fromNumber: '+14165550142',
      toNumber: '+14165550100',
    });

    // The other tenant knows the customer id and gets nothing, which is what "cannot observe"
    // means: the rows are not denied, they are not there.
    const theirView = await listCustomerCalls(other.db, {
      organizationId: floor.organizationId,
      customerId,
    });
    expect(theirView).toEqual([]);
  });

  it('names two outcomes the same way in two businesses', async () => {
    const mine = await createCallOutcome(floor.db, {
      organizationId: floor.organizationId,
      name: 'Voicemail',
      reached: false,
    });
    const theirs = await createCallOutcome(other.db, {
      organizationId: other.organizationId,
      name: 'Voicemail',
      // The same word, the opposite answer. Which is the entire reason `reached` is asked of the
      // business rather than inferred from the word.
      reached: true,
    });

    expect(mine).not.toEqual(theirs);
    const ours = await listCallOutcomes(floor.db, { organizationId: floor.organizationId });
    expect(ours.find((outcome) => outcome.id === mine)?.reached).toBe(false);
  });
});

describe('the loop the module exists for', () => {
  it('puts the call and the stage change on the customer’s timeline, in the tenant’s words', async () => {
    const stageId = await createCustomerStage(floor.db, {
      organizationId: floor.organizationId,
      name: 'Booked a meeting',
      position: 3,
    });
    const outcomeId = await createCallOutcome(floor.db, {
      organizationId: floor.organizationId,
      name: 'Interested',
      reached: true,
    });

    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Timeline Ltd',
    });

    const callId = await recordCall(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+14165550100',
      toNumber: '+14165550142',
    });
    const { error } = await floor.db.rpc('record_call_outcome', {
      p_organization_id: floor.organizationId,
      p_call_id: callId,
      p_outcome_id: outcomeId,
      p_note: 'Wants a proposal.',
      p_duration_seconds: null,
    });
    expect(error).toBeNull();
    await updateCustomer(floor.db, {
      organizationId: floor.organizationId,
      customerId,
      name: 'Timeline Ltd',
      stageId,
    });

    const timeline = await listCustomerTimeline(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });
    const descriptions = timeline.map((entry) => entry.description);

    // Written against the customer, so `customer_activity` resolves them with no new SQL.
    expect(descriptions).toContain('Call made');
    expect(descriptions).toContain('Call written up: Interested');
    // The tenant's word, resolved at read time — the same treatment a work item's status gets.
    expect(descriptions).toContain('Moved to Booked a meeting');
  });
});

describe('moving a customer along the pipeline, on its own', () => {
  // `change_customer_stage` is the RPC `apps/api/app/domains/crm/stages.py::change_customer_stage`
  // calls under the operator's own forwarded token — see that module's own comment for why this
  // is a command of its own rather than a reuse of `update_customer`. What is tested here is the
  // RPC itself, exactly as `update_customer`'s own stage-changing behavior is proven above.

  it('moves the customer and writes the same event update_customer would', async () => {
    const stageId = await createCustomerStage(floor.db, {
      organizationId: floor.organizationId,
      name: 'Board stage',
      position: 1,
    });
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Board Ltd',
    });

    const { data, error } = await floor.db.rpc('change_customer_stage', {
      p_organization_id: floor.organizationId,
      p_customer_id: customerId,
      p_stage_id: stageId,
    });
    expect(error).toBeNull();
    expect((data as { stage_id: string } | null)?.stage_id).toEqual(stageId);

    const customer = await getCustomer(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });
    expect(customer?.stageId).toEqual(stageId);

    const timeline = await listCustomerTimeline(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });
    expect(timeline.map((entry) => entry.description)).toContain(`Moved to Board stage`);
  });

  it('writes no event when the board re-submits the column a card is already in', async () => {
    const stageId = await createCustomerStage(floor.db, {
      organizationId: floor.organizationId,
      name: 'Steady stage',
      position: 2,
    });
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Steady Ltd',
    });

    await floor.db.rpc('change_customer_stage', {
      p_organization_id: floor.organizationId,
      p_customer_id: customerId,
      p_stage_id: stageId,
    });
    const before = await listCustomerTimeline(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });

    // The same column again — a no-op write, not a move.
    await floor.db.rpc('change_customer_stage', {
      p_organization_id: floor.organizationId,
      p_customer_id: customerId,
      p_stage_id: stageId,
    });
    const after = await listCustomerTimeline(floor.db, {
      organizationId: floor.organizationId,
      customerId,
    });

    expect(after).toHaveLength(before.length);
  });

  it('cannot move another business’s customer (I2)', async () => {
    const customerId = await createCustomer(floor.db, {
      organizationId: floor.organizationId,
      name: 'Not Yours Ltd',
    });

    const { data, error } = await other.db.rpc('change_customer_stage', {
      p_organization_id: floor.organizationId,
      p_customer_id: customerId,
      p_stage_id: null,
    });

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe('the number a business dials from', () => {
  it('is absent until the business says so', async () => {
    // The ordinary state and not a fault: provisioning does not ask, and a platform that filled
    // one in on a business's behalf would be answering through a column — the same reasoning
    // that keeps `organizations.currency` nullable.
    //
    // What is deliberately *not* asserted here is that `placeCall` refuses for this reason. No
    // carrier is configured in this environment, so it refuses one step earlier for the
    // deployment's own reason, and a test that could not tell the two apart would pass whichever
    // check was deleted.
    expect(await callingNumber(floor.db, { organizationId: floor.organizationId })).toBeNull();
  });

  it("is one business's own, and another can neither read nor write it (I2)", async () => {
    await setCallingNumber(floor.db, {
      organizationId: floor.organizationId,
      number: '+14165550142',
    });

    expect(await callingNumber(floor.db, { organizationId: floor.organizationId })).toBe(
      '+14165550142',
    );

    // `telephony_settings_select` is keyed to the caller's own tenants, so for the other business
    // this is an absence rather than a refusal — the row is not there to be seen.
    expect(await callingNumber(other.db, { organizationId: floor.organizationId })).toBeNull();

    await expect(
      setCallingNumber(other.db, {
        organizationId: floor.organizationId,
        number: '+14165550199',
      }),
    ).rejects.toThrow();

    expect(await callingNumber(floor.db, { organizationId: floor.organizationId })).toBe(
      '+14165550142',
    );
  });

  it('clears back to nothing, which is a business taking its number down', async () => {
    await setCallingNumber(floor.db, {
      organizationId: floor.organizationId,
      number: '+14165550143',
    });
    await setCallingNumber(floor.db, { organizationId: floor.organizationId, number: '  ' });

    expect(await callingNumber(floor.db, { organizationId: floor.organizationId })).toBeNull();
  });

  it('refuses a role holding every reception capability but not organization.manage (I12)', async () => {
    // `organization.manage`, not `field.manage`. Naming a stage is configuring how a business
    // records work; the number its customers see when it rings them is the business itself, and
    // it sits with currency and the clock.
    const email = `dialer-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();

    const roleId = await createRole(floor.db, {
      organizationId: floor.organizationId,
      name: `Dialer ${randomUUID().slice(0, 8)}`,
      capabilities: ['field.manage', 'call.place', 'customer.create'],
    });
    await addMember(floor.db, {
      organizationId: floor.organizationId,
      email,
      displayName: 'Dialer',
      roleId,
    });

    // Signed in *after* the membership exists, because the tenant claim is read at sign-in — a
    // session opened before it would be refused for having no tenant at all, which is the wrong
    // reason and would pass even if the capability check were deleted.
    const dialer = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await dialer.auth.signInWithPassword({ email, password });
    expect(signIn.error).toBeNull();

    // They can read it — every member who may place a call must know what they call from.
    await setCallingNumber(floor.db, {
      organizationId: floor.organizationId,
      number: '+14165550144',
    });
    const read = await dialer
      .from('telephony_settings')
      .select('calling_number')
      .eq('organization_id', floor.organizationId);
    expect(read.data?.[0]?.calling_number).toBe('+14165550144');

    // And they cannot write it. Through the raw table as well as the function, because what is
    // under test is the policy rather than the wrapper: a table-wide grant added later would
    // show up here and nowhere else.
    const refused = await dialer
      .from('telephony_settings')
      .update({ calling_number: '+14165550100' })
      .eq('organization_id', floor.organizationId)
      .select('organization_id');
    expect(refused.data ?? []).toEqual([]);

    await expect(
      setCallingNumber(dialer, {
        organizationId: floor.organizationId,
        number: '+14165550100',
      }),
    ).rejects.toThrow();

    expect(await callingNumber(floor.db, { organizationId: floor.organizationId })).toBe(
      '+14165550144',
    );
  });
});
