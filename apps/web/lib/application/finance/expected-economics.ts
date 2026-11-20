import type { Db } from '@/lib/db/types';
import { listPriceBookItems, type PriceBookItem } from '@/lib/domain/pricing/price-book';
import {
  expectedUnit,
  listItemExpectedCosts,
  listStageExpectedCosts,
  listWorkTypeResults,
  type ExpectedCostLine,
  type ExpectedUnit,
  type StageExpectedCost,
  type WorkTypeResult,
} from '@/lib/domain/pricing/expected-costs';
import { listOrganizationStatuses, type WorkItemStatus } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes, type WorkItemType } from '@/lib/domain/work-items/types';

/**
 * Expected and recorded economics of what a business sells, composed from the price book, the
 * expected costs on items and on the stages of the Work types that deliver them, and what jobs of
 * each type recorded. Calculates the forecast; stores nothing.
 */

export type StageWithCost = WorkItemStatus & { cost: StageExpectedCost | null };
export type ItemEconomics = { item: PriceBookItem; lines: ExpectedCostLine[]; stages: StageWithCost[]; expected: ExpectedUnit };

function stagesFor(typeId: string | null | undefined, statuses: Array<WorkItemStatus & { typeId: string }>, costs: Map<string, StageExpectedCost>): StageWithCost[] {
  if (!typeId) return [];
  return statuses.filter((status) => status.typeId === typeId).map((status) => ({ ...status, cost: costs.get(status.id) ?? null }));
}

function itemEconomics(item: PriceBookItem, lines: ExpectedCostLine[], stages: StageWithCost[]): ItemEconomics {
  return {
    item,
    lines,
    stages,
    expected: expectedUnit({
      price: { amountMinor: item.unitAmountMinor, currency: item.currency },
      lines,
      stages: stages.flatMap((stage) => (stage.cost ? [stage.cost] : [])),
    }),
  };
}

/** Stages of the given types with their expected costs, read once. */
async function readStages(db: Db, organizationId: string) {
  const statuses = await listOrganizationStatuses(db, { organizationId });
  const costs = new Map((await listStageExpectedCosts(db, { organizationId })).map((cost) => [cost.statusId, cost]));
  return { statuses, costs };
}

/** One priced item with its expected costs and the stages of the Work type that delivers it. */
export async function loadItemEconomics(db: Db, input: { organizationId: string; itemId: string }): Promise<ItemEconomics | null> {
  const items = await listPriceBookItems(db, { organizationId: input.organizationId });
  const item = items.find((candidate) => candidate.id === input.itemId);
  if (!item) return null;
  const [lines, { statuses, costs }] = await Promise.all([
    listItemExpectedCosts(db, { organizationId: input.organizationId, itemIds: [item.id] }),
    readStages(db, input.organizationId),
  ]);
  return itemEconomics(item, lines, stagesFor(item.deliveryTypeId, statuses, costs));
}

/** A Work type's stages with their expected costs, and the priced items it delivers with their expected margins. */
export async function loadTypeEconomics(
  db: Db,
  input: { organizationId: string; typeId: string; mayReadCosts: boolean },
): Promise<{ stages: StageWithCost[]; items: ItemEconomics[]; otherItems: PriceBookItem[] }> {
  const items = await listPriceBookItems(db, { organizationId: input.organizationId });
  const delivered = items.filter((item) => item.deliveryTypeId === input.typeId);
  const otherItems = items.filter((item) => !item.deliveryTypeId);
  const [lines, { statuses, costs }] = await Promise.all([
    input.mayReadCosts ? listItemExpectedCosts(db, { organizationId: input.organizationId, itemIds: delivered.map((item) => item.id) }) : Promise.resolve([]),
    input.mayReadCosts ? readStages(db, input.organizationId) : Promise.resolve({ statuses: [], costs: new Map<string, StageExpectedCost>() }),
  ]);
  const stages = stagesFor(input.typeId, statuses, costs);
  return {
    stages,
    items: delivered.map((item) => itemEconomics(item, lines.filter((line) => line.itemId === item.id), stages)),
    otherItems,
  };
}

export type TypeEconomics = {
  type: WorkItemType;
  result: WorkTypeResult;
  /** Expected margin of one job, from the items the type delivers in the currency; a range when they differ. */
  expectedMargin: { low: number; high: number } | null;
};

/**
 * Finance → Reports: each priced item's expected unit economics, and each Work type's recorded
 * results in the period beside the expected margin of its open work.
 */
export async function loadExpectedEconomics(
  db: Db,
  input: { organizationId: string; currency: string; from: string; to: string },
): Promise<{ items: ItemEconomics[]; types: TypeEconomics[]; typeNames: Map<string, string> }> {
  const [priceBook, types, lines, { statuses, costs }, results] = await Promise.all([
    listPriceBookItems(db, { organizationId: input.organizationId }),
    listWorkItemTypes(db, { organizationId: input.organizationId, includeArchived: true }),
    listItemExpectedCosts(db, { organizationId: input.organizationId }),
    readStages(db, input.organizationId),
    listWorkTypeResults(db, { organizationId: input.organizationId, currency: input.currency, from: input.from, to: input.to }),
  ]);
  const items = priceBook.map((item) => itemEconomics(item, lines.filter((line) => line.itemId === item.id), stagesFor(item.deliveryTypeId, statuses, costs)));
  const resultByType = new Map(results.map((result) => [result.typeId, result]));
  const typeEconomics = types.flatMap((type): TypeEconomics[] => {
    const result = resultByType.get(type.id);
    const delivered = items.filter((economics) => economics.item.deliveryTypeId === type.id);
    if (!result || (type.archivedAt && result.finishedJobs === 0 && result.openJobs === 0)) return [];
    if (delivered.length === 0 && result.finishedJobs === 0 && result.openJobs === 0) return [];
    const margins = delivered
      .filter((economics) => economics.item.currency === input.currency && economics.expected.marginMinor !== null)
      .map((economics) => economics.expected.marginMinor as number);
    return [{ type, result, expectedMargin: margins.length ? { low: Math.min(...margins), high: Math.max(...margins) } : null }];
  });
  return { items, types: typeEconomics, typeNames: new Map(types.map((type) => [type.id, type.name])) };
}
