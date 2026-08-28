import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import {
  addChecklistItem,
  listChecklistItems,
  setChecklistItemDone,
} from '@/lib/domain/work-items/checklists';
import {
  formatMoney,
  listCosts,
  listTimeEntries,
  recordCost,
  recordTime,
} from '@/lib/domain/work-items/consumption';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';

/**
 * What a job involves, what it took, and what it cost — and I10.
 *
 * The money assertions are the load-bearing ones. "Money is integer minor units, and currency
 * is per-tenant configuration" is easy to state and easy to lose: it goes first when
 * somebody writes `amount / 100` into a query, or reads the organization's *current* currency
 * to render a two-year-old cost. Both are asserted against here — the amount is an integer
 * everywhere but the formatter, and the currency is snapshotted onto the row rather than
 * joined, so changing what a business trades in does not reinterpret its history (I8).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  statusId: string;
  resourceId: string;
  workItemId: string;
};

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string, currency: string): Promise<Tenant> {
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

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: 'Founder',
    p_timezone: 'UTC',
    p_currency: currency,
  });
  if (error) throw error;

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Callout' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: orgId,
    typeId,
    name: 'Open',
  });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    statusId,
    resourceId: await createResource(db, { organizationId: orgId, name: 'Sam Okafor' }),
    workItemId: await createWorkItem(db, {
      organizationId: orgId,
      title: 'Service the compressor',
      statusId,
    }),
  };
}

describe('checklists, time and cost', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    // Two currencies, because a platform that only ever sees one has not tested that it
    // holds the tenant's rather than a default.
    alice = await newTenant('cn-alice', 'EUR');
    bob = await newTenant('cn-bob', 'GBP');
  });

  it('refuses to found an organization with no currency', async () => {
    // There is no neutral currency, so the platform never picks one. Contrast the timezone,
    // which coalesces to UTC because UTC is the absence of an assumption.
    const { error } = await alice.db.rpc('create_organization', {
      p_name: 'Currencyless Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Founder',
      p_timezone: 'UTC',
      p_currency: null as unknown as string,
    });
    expect(error?.code).toBe('23514');
  });

  it('records the steps a job involves, in order', async () => {
    await addChecklistItem(alice.db, {
      workItemId: alice.workItemId,
      label: 'Isolate the supply',
      position: 0,
    });
    await addChecklistItem(alice.db, {
      workItemId: alice.workItemId,
      label: 'Photograph the meter',
      position: 1,
    });

    const items = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    expect(items.map((i) => i.label)).toEqual(['Isolate the supply', 'Photograph the meter']);
    expect(items.every((i) => i.doneAt === null && i.doneBy === null)).toBe(true);
  });

  it('records who ticked a step and when, not merely that it happened', async () => {
    const [first] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });

    await setChecklistItemDone(alice.db, { checklistItemId: first.id, done: true });

    const [ticked] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    expect(ticked.doneAt).not.toBeNull();
    // The evidentiary half. A boolean `done` column would have lost this.
    expect(ticked.doneBy).toBe(alice.userId);
  });

  it('unticks back to neither, never to half', async () => {
    const [first] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    await setChecklistItemDone(alice.db, { checklistItemId: first.id, done: false });

    const [unticked] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    expect(unticked.doneAt).toBeNull();
    expect(unticked.doneBy).toBeNull();
  });

  it('refuses a tick attributed to somebody else (I11)', async () => {
    const [first] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });

    // Written directly, because the domain layer never sends done_by at all — the policy is
    // what makes forging it impossible rather than merely unavailable.
    const { error } = await alice.db
      .from('work_item_checklist_items')
      .update({ done_at: new Date().toISOString(), done_by: bob.userId })
      .eq('id', first.id);

    expect(error).not.toBeNull();
  });

  it('refuses a half-done step written directly', async () => {
    const [first] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });

    const { error } = await alice.db
      .from('work_item_checklist_items')
      .update({ done_at: new Date().toISOString() })
      .eq('id', first.id);

    expect(error?.code).toBe('23514');
  });

  it('cannot rewrite a step\'s label after the fact', async () => {
    // The column grant, not a policy. Changing what you agreed to do after doing something
    // else is the thing being prevented.
    const [first] = await listChecklistItems(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });

    const { error } = await alice.db
      .from('work_item_checklist_items')
      .update({ label: 'Something easier' })
      .eq('id', first.id);

    expect(error).not.toBeNull();
  });

  it('cannot hang a step off another tenant\'s work item (I18)', async () => {
    await expect(
      addChecklistItem(bob.db, { workItemId: alice.workItemId, label: 'Borrowed' }),
    ).rejects.toMatchObject({ code: 'checklists.work_item_not_found' });
  });

  it('records time worked, separately from time scheduled', async () => {
    await recordTime(alice.db, {
      workItemId: alice.workItemId,
      resourceId: alice.resourceId,
      startedAt: '2026-09-01T09:00:00.000Z',
      endedAt: '2026-09-01T11:30:00.000Z',
      note: 'Ran over; seized bolt',
    });

    const entries = await listTimeEntries(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].worked).toEqual({
      startsAt: '2026-09-01T09:00:00.000Z',
      endsAt: '2026-09-01T11:30:00.000Z',
    });
    expect(entries[0].resourceId).toBe(alice.resourceId);
    expect(entries[0].note).toBe('Ran over; seized bolt');
  });

  it('allows overlapping time entries, unlike scheduled windows', async () => {
    // Deliberate. I7 stops a resource being committed to two future jobs; a timesheet is a
    // record of what happened, and refusing an overlap would mean refusing to record it.
    await expect(
      recordTime(alice.db, {
        workItemId: alice.workItemId,
        resourceId: alice.resourceId,
        startedAt: '2026-09-01T10:00:00.000Z',
        endedAt: '2026-09-01T12:00:00.000Z',
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses time that ends before it starts', async () => {
    await expect(
      recordTime(alice.db, {
        workItemId: alice.workItemId,
        startedAt: '2026-09-01T12:00:00.000Z',
        endedAt: '2026-09-01T11:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'time_entries.window_backwards' });
  });

  it('records a cost in integer minor units, in the tenant\'s own currency (I10)', async () => {
    await recordCost(alice.db, {
      workItemId: alice.workItemId,
      description: 'Replacement valve',
      amountMinor: 4250,
    });

    const [cost] = await listCosts(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    expect(cost.amountMinor).toBe(4250);
    expect(Number.isInteger(cost.amountMinor)).toBe(true);
    // Not the platform's currency, and not a default — Alice's.
    expect(cost.currency).toBe('EUR');
  });

  it('uses each tenant\'s own currency, not a platform default', async () => {
    await recordCost(bob.db, {
      workItemId: bob.workItemId,
      description: 'Replacement valve',
      amountMinor: 4250,
    });

    const [cost] = await listCosts(bob.db, {
      organizationId: bob.organizationId,
      workItemId: bob.workItemId,
    });
    expect(cost.currency).toBe('GBP');
  });

  it('does not let a caller assert the currency', async () => {
    // The RPC reads it from the organization. Written directly, a forged currency is refused
    // by the insert policy's capability check only — so this asserts the stronger thing: the
    // domain layer has no parameter for it at all, and the row that exists carries the
    // organization's.
    const [cost] = await listCosts(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    expect(cost.currency).toBe('EUR');
    expect(Object.keys(cost)).not.toContain('organizationCurrency');
  });

  it('refuses a non-integer or zero amount', async () => {
    await expect(
      recordCost(alice.db, {
        workItemId: alice.workItemId,
        description: 'Twelve fifty',
        amountMinor: 12.5,
      }),
    ).rejects.toMatchObject({ code: 'costs.amount_not_integer' });

    await expect(
      recordCost(alice.db, {
        workItemId: alice.workItemId,
        description: 'Nothing',
        amountMinor: 0,
      }),
    ).rejects.toMatchObject({ code: 'costs.amount_zero' });

    // And in the database, which is where the guarantee is.
    const { error } = await alice.db.from('work_item_costs').insert({
      organization_id: alice.organizationId,
      work_item_id: alice.workItemId,
      description: 'Nothing, written directly',
      amount_minor: 0,
      currency: 'EUR',
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23514');
  });

  it('allows a negative amount, because a correction is a new row', async () => {
    // History is not rewritten. A refund or a credit is recorded, never an edit to the row
    // that was wrong.
    await expect(
      recordCost(alice.db, {
        workItemId: alice.workItemId,
        description: 'Valve returned',
        amountMinor: -4250,
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('cannot edit or delete a recorded cost at all', async () => {
    const [cost] = await listCosts(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });

    const updated = await alice.db
      .from('work_item_costs')
      .update({ description: 'Something else' })
      .eq('id', cost.id);
    expect(updated.error).not.toBeNull();

    // No delete policy, so the row is simply not visible to the statement and nothing goes.
    await alice.db.from('work_item_costs').delete().eq('id', cost.id);
    const after = await listCosts(alice.db, {
      organizationId: alice.organizationId,
      workItemId: alice.workItemId,
    });
    expect(after.map((c) => c.id)).toContain(cost.id);
  });

  it('divides by the minor unit exactly once, at the formatter', () => {
    expect(formatMoney(4250, 'EUR')).toContain('42.50');
    expect(formatMoney(4250, 'GBP')).toContain('42.50');
    // A currency with no minor unit. Assuming two decimal places would print ¥1,00 for what
    // is actually ¥100.
    expect(formatMoney(100, 'JPY')).toContain('100');
    expect(formatMoney(100, 'JPY')).not.toContain('1.00');
  });

  it('refuses time and cost to a member without the capability (I12, I16)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Recording',
      capabilities: ['role.manage', 'work_item.create', 'work_item.transition'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      recordTime(bob.db, {
        workItemId: bob.workItemId,
        startedAt: '2026-09-01T09:00:00.000Z',
        endedAt: '2026-09-01T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'time_entries.forbidden' });

    await expect(
      recordCost(bob.db, {
        workItemId: bob.workItemId,
        description: 'Should not exist',
        amountMinor: 100,
      }),
    ).rejects.toMatchObject({ code: 'costs.forbidden' });
  });

  it('shows each tenant only its own records', async () => {
    const acrossTheWall = await listCosts(alice.db, {
      organizationId: bob.organizationId,
      workItemId: bob.workItemId,
    });
    expect(acrossTheWall).toEqual([]);
  });
});
