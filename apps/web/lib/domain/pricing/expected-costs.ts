import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business expects selling and delivering something to cost: cost lines on a priced item
 * (materials, parts, supplier charges per unit) and, on each stage of the Work type that delivers it,
 * the time spent there and what the people and equipment busy in it cost per hour. Assumptions for
 * planning, read with `cost.read` and written with `cost.manage`; recorded cost stays
 * `work_item_costs`, and nothing here changes a quote, job, invoice or report total.
 */

export type ExpectedCostLine = { id: string; itemId: string; description: string; amountMinor: number; currency: string };
export type StageExpectedCost = { statusId: string; expectedMinutes: number; hourlyCostMinor: number; currency: string };

export async function listItemExpectedCosts(db: Db, input: { organizationId: string; itemIds?: string[] }): Promise<ExpectedCostLine[]> {
  if (input.itemIds && input.itemIds.length === 0) return [];
  let query = db
    .from('price_book_item_expected_costs')
    .select('id, item_id, description, amount_minor, currency')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: true });
  if (input.itemIds) query = query.in('item_id', input.itemIds);
  const { data, error } = await query;
  if (error) throw fromDatabaseError(error, 'expected_costs.read_failed');
  return (data ?? []).map((row) => ({ id: row.id, itemId: row.item_id, description: row.description, amountMinor: row.amount_minor, currency: row.currency }));
}

export async function addItemExpectedCost(
  db: Db,
  input: { organizationId: string; itemId: string; description: string; amountMinor: number; currency: string },
): Promise<void> {
  const actor = await requireActor(db);
  const description = input.description.trim();
  if (description.length === 0) throw new DomainError('Say what the cost is for.', 'expected_costs.description_required');
  if (description.length > 120) throw new DomainError('Keep the description to 120 characters.', 'expected_costs.description_too_long');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) throw new DomainError('Enter an amount of zero or more.', 'expected_costs.amount_invalid');
  const { error } = await db.from('price_book_item_expected_costs').insert({
    organization_id: input.organizationId,
    item_id: input.itemId,
    description,
    amount_minor: input.amountMinor,
    currency: input.currency,
    created_by: actor.id,
  });
  if (error) {
    if (error.code === '42501') throw new DomainError('Your role cannot change expected costs.', 'expected_costs.forbidden');
    throw fromDatabaseError(error, 'expected_costs.add_failed');
  }
}

export async function removeItemExpectedCost(db: Db, input: { organizationId: string; id: string }): Promise<void> {
  await requireActor(db);
  const { data, error } = await db
    .from('price_book_item_expected_costs')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('id', input.id)
    .select('id');
  if (error) throw fromDatabaseError(error, 'expected_costs.remove_failed');
  if (!data?.length) throw new DomainError('Your role cannot change expected costs.', 'expected_costs.forbidden');
}

export async function listStageExpectedCosts(db: Db, input: { organizationId: string; statusIds?: string[] }): Promise<StageExpectedCost[]> {
  if (input.statusIds && input.statusIds.length === 0) return [];
  let query = db
    .from('work_item_status_expected_costs')
    .select('status_id, expected_minutes, hourly_cost_minor, currency')
    .eq('organization_id', input.organizationId);
  if (input.statusIds) query = query.in('status_id', input.statusIds);
  const { data, error } = await query;
  if (error) throw fromDatabaseError(error, 'expected_costs.read_failed');
  return (data ?? []).map((row) => ({ statusId: row.status_id, expectedMinutes: row.expected_minutes, hourlyCostMinor: row.hourly_cost_minor, currency: row.currency }));
}

/** Sets a stage's expected time and cost per hour, or clears both when `value` is null. */
export async function setStageExpectedCost(
  db: Db,
  input: { organizationId: string; statusId: string; value: { expectedMinutes: number; hourlyCostMinor: number; currency: string } | null },
): Promise<void> {
  const actor = await requireActor(db);
  const table = () => db.from('work_item_status_expected_costs');
  if (input.value === null) {
    const { error } = await table().delete().eq('organization_id', input.organizationId).eq('status_id', input.statusId);
    if (error) throw fromDatabaseError(error, 'expected_costs.save_failed');
    return;
  }
  const { expectedMinutes, hourlyCostMinor, currency } = input.value;
  if (!Number.isInteger(expectedMinutes) || expectedMinutes < 1 || expectedMinutes > 100000) throw new DomainError('Enter the expected time in whole minutes, at least 1.', 'expected_costs.minutes_invalid');
  if (!Number.isSafeInteger(hourlyCostMinor) || hourlyCostMinor < 0) throw new DomainError('Enter a cost per hour of zero or more.', 'expected_costs.amount_invalid');
  // Update first, then insert: an upsert would also write the key columns, which nobody may change.
  const { data, error } = await table()
    .update({ expected_minutes: expectedMinutes, hourly_cost_minor: hourlyCostMinor, currency, updated_at: new Date().toISOString(), updated_by: actor.id })
    .eq('organization_id', input.organizationId)
    .eq('status_id', input.statusId)
    .select('status_id');
  if (error) {
    if (error.code === '42501') throw new DomainError('Your role cannot change expected costs.', 'expected_costs.forbidden');
    throw fromDatabaseError(error, 'expected_costs.save_failed');
  }
  if (data?.length) return;
  const inserted = await table().insert({
    status_id: input.statusId,
    organization_id: input.organizationId,
    expected_minutes: expectedMinutes,
    hourly_cost_minor: hourlyCostMinor,
    currency,
    updated_by: actor.id,
  });
  if (inserted.error) {
    if (inserted.error.code === '42501') throw new DomainError('Your role cannot change expected costs.', 'expected_costs.forbidden');
    throw fromDatabaseError(inserted.error, 'expected_costs.save_failed');
  }
}

/** A stage's expected cost: minutes × cost per hour, rounded half up once to the minor unit. */
export function stageCostMinor(stage: Pick<StageExpectedCost, 'expectedMinutes' | 'hourlyCostMinor'>): number {
  return Math.round((stage.expectedMinutes * stage.hourlyCostMinor) / 60);
}

export type ExpectedUnit = {
  /** Null when nothing is expected yet, or when an assumption is in another currency than the price. */
  costMinor: number | null;
  /** Null under the same conditions as `costMinor`. */
  marginMinor: number | null;
  itemCostMinor: number;
  stageCostMinor: number;
  /** Total expected minutes across the delivering type's stages. */
  minutes: number;
  /** Why the figure is missing, in the business's terms, or null when it is complete. */
  issue: string | null;
};

/**
 * The expected cost and margin of one unit of a priced item: its own expected cost lines plus the
 * expected time and cost of every stage of the Work type that delivers it. Nothing is converted
 * between currencies; a figure that would need converting is missing, with the reason.
 */
export function expectedUnit(input: {
  price: { amountMinor: number; currency: string };
  lines: readonly Pick<ExpectedCostLine, 'amountMinor' | 'currency'>[];
  stages: readonly StageExpectedCost[];
}): ExpectedUnit {
  const { price, lines, stages } = input;
  const minutes = stages.reduce((total, stage) => total + stage.expectedMinutes, 0);
  const itemCost = lines.reduce((total, line) => total + line.amountMinor, 0);
  const stageCost = stages.reduce((total, stage) => total + stageCostMinor(stage), 0);
  const base = { itemCostMinor: itemCost, stageCostMinor: stageCost, minutes };
  if (lines.length === 0 && stages.length === 0) return { ...base, costMinor: null, marginMinor: null, issue: 'No expected costs yet.' };
  const foreign = [...lines, ...stages].find((assumption) => assumption.currency !== price.currency);
  if (foreign) return { ...base, costMinor: null, marginMinor: null, issue: `An expected cost is in ${foreign.currency}, the price in ${price.currency}.` };
  const costMinor = itemCost + stageCost;
  return { ...base, costMinor, marginMinor: price.amountMinor - costMinor, issue: null };
}

/** Margin as a share of the price, to one decimal place; null when it is undefined. */
export function marginPercent(marginMinor: number | null, priceMinor: number): number | null {
  if (marginMinor === null || priceMinor <= 0) return null;
  return Math.round((marginMinor / priceMinor) * 1000) / 10;
}

export type WorkTypeResult = {
  typeId: string;
  finishedJobs: number;
  pricedJobs: number;
  pricedMinor: number;
  costMinor: number;
  openJobs: number;
};

/** Per Work type: jobs finished in the period with what they were priced at and cost, and jobs open now. */
export async function listWorkTypeResults(
  db: Db,
  input: { organizationId: string; currency: string; from?: string; to?: string },
): Promise<WorkTypeResult[]> {
  const { data, error } = await db.rpc('work_type_results', {
    p_organization_id: input.organizationId,
    p_currency: input.currency,
    p_from: input.from,
    p_to: input.to,
  });
  if (error) throw fromDatabaseError(error, 'work_type_results.read_failed');
  return (data ?? []).map((row) => ({
    typeId: row.type_id,
    finishedJobs: Number(row.finished_jobs),
    pricedJobs: Number(row.priced_jobs),
    pricedMinor: Number(row.priced_minor),
    costMinor: Number(row.cost_minor),
    openJobs: Number(row.open_jobs),
  }));
}
