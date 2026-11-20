import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addItemExpectedCost,
  listItemExpectedCosts,
  listStageExpectedCosts,
  listWorkTypeResults,
  setStageExpectedCost,
} from '@/lib/domain/pricing/expected-costs';
import { createPriceBookItem, setCatalogDeliveryType } from '@/lib/domain/pricing/price-book';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { recordCost } from '@/lib/domain/work-items/consumption';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { changeWorkItemStatus } from '@/lib/domain/work-items/transitions';
import { addStarterStages, createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * What a business expects selling something to cost — lines on a priced item, time and cost per
 * hour on the stages of the Work type that delivers it — and what each type's jobs recorded. Costs
 * are seen only with `cost.read` and changed only with `cost.manage`; a line is in its item's
 * currency; one business never sees another's; a finished job is counted once.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let owner: Person;
let clerk: Person;
let outsider: Person;
let organizationId: string;
let typeId: string;
let itemId: string;
let statuses: { id: string; name: string }[];

async function person(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  owner = await person('costs-owner');
  organizationId = await foundBusiness({ ownerEmail: owner.email, name: `Garage ${randomUUID().slice(0, 8)}`, currency: 'EUR' });
  outsider = await person('costs-outsider');
  await foundBusiness({ ownerEmail: outsider.email, name: `Other ${randomUUID().slice(0, 8)}`, currency: 'EUR' });

  // Prices, work and reports, but not what things cost.
  clerk = await person('costs-clerk');
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.roles (organization_id, name, capabilities, created_by)
     values ($1, 'Clerk', array['price.manage','field.manage','report.read','work_item.create'], $2) returning id`,
    [organizationId, owner.userId],
  );
  await pg.query('insert into public.memberships (organization_id, user_id, role_id, created_by) values ($1, $2, $3, $4)', [organizationId, clerk.userId, rows[0].id, owner.userId]);

  // The owner holds every permission, the cost permissions included.
  const held = await pg.query<{ ok: boolean }>(
    `select r.capabilities @> array['cost.read','cost.manage','report.read'] as ok
       from public.memberships m join public.roles r on r.id = m.role_id where m.organization_id = $1 and m.user_id = $2`,
    [organizationId, owner.userId],
  );
  expect(held.rows[0].ok).toBe(true);

  typeId = await createWorkItemType(owner.db, { organizationId, name: 'Oil change', schedulable: false });
  await addStarterStages(owner.db, { organizationId, typeId });
  statuses = await listWorkItemStatuses(owner.db, { organizationId, typeId });
  itemId = await createPriceBookItem(owner.db, { organizationId, name: 'Oil change, workshop', unit: 'job', unitAmountMinor: 8900 });
  await setCatalogDeliveryType(owner.db, itemId, typeId);
}, 120_000);

afterAll(async () => {
  await pg?.end();
});

describe('starter stages', () => {
  it('gives a type with no stages Booked, In progress and Done, and refuses a type that has stages', async () => {
    expect(statuses.map((status) => status.name)).toEqual(['Booked', 'In progress', 'Done']);
    await expect(addStarterStages(owner.db, { organizationId, typeId })).rejects.toThrow('This type already has stages.');
  });
});

describe('expected cost lines on a priced item', () => {
  it('are recorded in the item’s currency by someone who may manage costs', async () => {
    await addItemExpectedCost(owner.db, { organizationId, itemId, description: 'Oil and filter', amountMinor: 2500, currency: 'EUR' });
    const lines = await listItemExpectedCosts(owner.db, { organizationId, itemIds: [itemId] });
    expect(lines.map((line) => [line.description, line.amountMinor, line.currency])).toEqual([['Oil and filter', 2500, 'EUR']]);
  });

  it('refuse a line in another currency than the item', async () => {
    await expect(addItemExpectedCost(owner.db, { organizationId, itemId, description: 'Imported part', amountMinor: 100, currency: 'USD' }))
      .rejects.toThrow();
  });

  it('are invisible and unchangeable without the cost permissions, and to another business', async () => {
    expect(await listItemExpectedCosts(clerk.db, { organizationId, itemIds: [itemId] })).toEqual([]);
    await expect(addItemExpectedCost(clerk.db, { organizationId, itemId, description: 'Rag', amountMinor: 10, currency: 'EUR' }))
      .rejects.toThrow('Your role cannot change expected costs.');
    expect(await listItemExpectedCosts(outsider.db, { organizationId, itemIds: [itemId] })).toEqual([]);
  });
});

describe('expected time and cost of a stage', () => {
  it('is set, changed and cleared by someone who may manage costs', async () => {
    const inProgress = statuses[1].id;
    await setStageExpectedCost(owner.db, { organizationId, statusId: inProgress, value: { expectedMinutes: 45, hourlyCostMinor: 6000, currency: 'EUR' } });
    await setStageExpectedCost(owner.db, { organizationId, statusId: inProgress, value: { expectedMinutes: 30, hourlyCostMinor: 6000, currency: 'EUR' } });
    expect(await listStageExpectedCosts(owner.db, { organizationId, statusIds: [inProgress] }))
      .toEqual([{ statusId: inProgress, expectedMinutes: 30, hourlyCostMinor: 6000, currency: 'EUR' }]);

    expect(await listStageExpectedCosts(clerk.db, { organizationId, statusIds: [inProgress] })).toEqual([]);
    await expect(setStageExpectedCost(clerk.db, { organizationId, statusId: inProgress, value: { expectedMinutes: 1, hourlyCostMinor: 1, currency: 'EUR' } }))
      .rejects.toThrow();
    expect(await listStageExpectedCosts(outsider.db, { organizationId, statusIds: [inProgress] })).toEqual([]);

    const booked = statuses[0].id;
    await setStageExpectedCost(owner.db, { organizationId, statusId: booked, value: { expectedMinutes: 10, hourlyCostMinor: 3000, currency: 'EUR' } });
    await setStageExpectedCost(owner.db, { organizationId, statusId: booked, value: null });
    expect(await listStageExpectedCosts(owner.db, { organizationId, statusIds: [booked] })).toEqual([]);
  });
});

describe('what a Work type’s jobs recorded', () => {
  it('counts a finished job once, with its price and recorded cost, and the jobs still open', async () => {
    const [booked, inProgress, done] = statuses.map((status) => status.id);
    const finished = await createWorkItem(owner.db, { organizationId, title: 'Oil change for Ana', statusId: booked });
    await addPricedLine(owner.db, { workItemId: finished, priceBookItemId: itemId, quantity: 1 });
    await recordCost(owner.db, { workItemId: finished, description: 'Oil', amountMinor: 3100 });
    await changeWorkItemStatus(owner.db, { workItemId: finished, toStatusId: inProgress });
    await changeWorkItemStatus(owner.db, { workItemId: finished, toStatusId: done });

    await createWorkItem(owner.db, { organizationId, title: 'Oil change for Ben', statusId: booked });
    await createWorkItem(owner.db, { organizationId, title: 'Oil change for Cy', statusId: booked });

    const result = (await listWorkTypeResults(owner.db, { organizationId, currency: 'EUR' })).find((row) => row.typeId === typeId);
    expect(result).toEqual({ typeId, finishedJobs: 1, pricedJobs: 1, pricedMinor: 8900, costMinor: 3100, openJobs: 2 });

    const none = (await listWorkTypeResults(owner.db, { organizationId, currency: 'USD' })).find((row) => row.typeId === typeId);
    expect(none).toMatchObject({ finishedJobs: 1, pricedJobs: 0, pricedMinor: 0, costMinor: 0 });
  });

  it('is refused to a member who may not read reports and to another business', async () => {
    const mechanic = await person('costs-mechanic');
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.roles (organization_id, name, capabilities, created_by)
       values ($1, 'Mechanic', array['work_item.create'], $2) returning id`,
      [organizationId, owner.userId],
    );
    await pg.query('insert into public.memberships (organization_id, user_id, role_id, created_by) values ($1, $2, $3, $4)', [organizationId, mechanic.userId, rows[0].id, owner.userId]);

    await expect(listWorkTypeResults(mechanic.db, { organizationId, currency: 'EUR' })).rejects.toThrow();
    await expect(listWorkTypeResults(outsider.db, { organizationId, currency: 'EUR' })).rejects.toThrow();
  });
});
