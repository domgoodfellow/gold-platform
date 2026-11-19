import { createHash } from 'node:crypto';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { downloadImportFile } from '@/lib/domain/integrations/resources';
import { findSavedPlan } from '@/lib/domain/integrations/mappings';
import { parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { discoverSource, isSensitiveColumn, type ColumnProfile } from './discovery';
import { expandRows, type PlanOrigin } from './inspect';
import { keyNorm, plain } from './normalize';
import { sourceSignature } from './plan';

/**
 * A source read as price book items: which column holds each item's name, unit, price, currency
 * and stable ID, and the unit for rows that name none. Like a contact translation it is saved as
 * the mapping's one field, snapshotted by the run, and reused for a later source of the business
 * with the same columns. Matching to existing items (by the source's ID, else by name) and
 * applying happen in the database (`stage_price_book_import_rows`, `apply_price_book_import_run`).
 */

export const PRICE_CONCEPTS = ['item_name', 'price', 'unit', 'currency', 'source_id'] as const;
export type PriceConcept = typeof PRICE_CONCEPTS[number];
export type PriceMapping = Partial<Record<PriceConcept, string>>;

export const PRICE_CONCEPT_LABELS: Record<PriceConcept, string> = {
  item_name: 'Item name', price: 'Price', unit: 'Unit', currency: 'Currency', source_id: 'Source ID',
};

// Compared with `keyNorm`, so case, spacing and punctuation do not matter: "Product/Service Name" is `productservicename`.
const PRICE_ALIASES: Record<PriceConcept, string[]> = {
  item_name: ['item_name', 'item', 'product_service_name', 'product_service', 'product_name', 'product', 'service_name', 'service', 'name', 'title'],
  price: ['price', 'unit_price', 'sales_price_rate', 'sales_price', 'rate', 'price_each', 'list_price', 'selling_price', 'amount'],
  unit: ['unit', 'units', 'uom', 'unit_of_measure', 'per', 'billing_unit'],
  currency: ['currency', 'currency_code'],
  source_id: ['item_id', 'product_id', 'sku', 'item_code', 'code', 'external_id', 'id'],
};

export type PriceBookPlan = {
  version: 1;
  mapping: PriceMapping;
  /** The unit for a row whose unit column is empty, or for every row when no column holds one. The business's own word. */
  defaultUnit: string | null;
  /** The source's column names (`sourceSignature`), so a later source with the same columns starts from this plan. */
  signature?: string;
};

/** The first column named like each concept; a column supplies one concept only. */
export function suggestPriceMapping(columns: readonly string[]): PriceMapping {
  const byKey = new Map<string, string>();
  for (const column of columns) if (!isSensitiveColumn(column) && !byKey.has(keyNorm(column))) byKey.set(keyNorm(column), column);
  const used = new Set<string>();
  const mapping: PriceMapping = {};
  for (const concept of PRICE_CONCEPTS) {
    for (const alias of PRICE_ALIASES[concept]) {
      const column = byKey.get(keyNorm(alias));
      if (column && !used.has(column)) { mapping[concept] = column; used.add(column); break; }
    }
  }
  return mapping;
}

/** Refuses a plan that names a column the source lacks, a sensitive column, a column twice, or lacks a name, a price or any unit. */
export function validatePriceBookPlan(plan: PriceBookPlan, columns: readonly string[]): PriceBookPlan {
  const known = new Set(columns);
  const used = new Set<string>();
  const mapping: PriceMapping = {};
  for (const [concept, column] of Object.entries(plan.mapping ?? {}) as [string, string | undefined][]) {
    if (!column) continue;
    if (!(PRICE_CONCEPTS as readonly string[]).includes(concept)) throw new DomainError(`“${concept}” is not something a price book import can read.`, 'integrations.plan_invalid');
    if (!known.has(column)) throw new DomainError(`The source has no column named “${column}”.`, 'integrations.plan_invalid');
    if (isSensitiveColumn(column)) throw new DomainError(`“${column}” may hold a credential and cannot be read.`, 'integrations.plan_invalid');
    if (used.has(column)) throw new DomainError(`“${column}” can supply one value only.`, 'integrations.plan_invalid');
    used.add(column);
    mapping[concept as PriceConcept] = column;
  }
  if (!mapping.item_name) throw new DomainError('Choose which column holds the item name.', 'integrations.plan_invalid');
  if (!mapping.price) throw new DomainError('Choose which column holds the price.', 'integrations.plan_invalid');
  const defaultUnit = plain(plan.defaultUnit) || null;
  if (defaultUnit && defaultUnit.length > 40) throw new DomainError('Keep the unit to 40 characters or fewer.', 'integrations.plan_invalid');
  if (!mapping.unit && !defaultUnit) throw new DomainError('Choose the unit column, or enter the unit these items are sold in.', 'integrations.plan_invalid');
  const signature = typeof plan.signature === 'string' && plan.signature ? plan.signature : undefined;
  return { version: 1, mapping, defaultUnit, ...(signature ? { signature } : {}) };
}

/**
 * A price as integer minor units of the business's currency. Currency symbols, a trailing
 * currency code and thousands separators are dropped; a comma that could be a decimal separator
 * is refused rather than guessed.
 */
export function readPrice(value: unknown, currency: string): { minor: number } | { error: string } {
  const text = plain(value).replace(/\s/g, '').replace(/^[A-Za-z]{0,3}[$€£¥]/, '').replace(/[A-Za-z]{3}$/, '');
  if (!text) return { error: 'No price.' };
  if (/^[^.]*,\d{1,2}$/.test(text)) return { error: `“${plain(value)}” could be read two ways. Write the price with a decimal point.` };
  const number = text.replace(/,(?=\d{3}(?:\D|$))/g, '');
  if (number.startsWith('-')) return { error: 'A price cannot be negative.' };
  try { return { minor: parseMoneyInput(number, currency) }; }
  catch (error) {
    if (error instanceof DomainError) return { error: `“${plain(value)}” is not a price.` };
    throw error;
  }
}

export type PriceRow = {
  key: string;
  raw: Record<string, string>;
  normalized: { name: string; unit: string; unit_amount_minor: number | null; currency: string };
  validation_errors: string[];
  hold: false;
};

/** Each source row as one item to stage, with a stable key: the source ID when the plan reads one, else the row's content. */
export function priceRowsForPlan(rows: Record<string, string>[], input: { sourceName: string; plan: PriceBookPlan; currency: string }): PriceRow[] {
  const namespace = createHash('sha256').update(input.sourceName).digest('hex');
  const { mapping, defaultUnit } = input.plan;
  const seen = new Map<string, number>();
  return rows.map((raw) => {
    const read = (concept: PriceConcept) => (mapping[concept] ? plain(raw[mapping[concept]!]) : '');
    const errors: string[] = [];
    const name = read('item_name');
    if (!name) errors.push('No item name.');
    else if (name.length > 200) errors.push('The item name is longer than 200 characters.');
    const unit = read('unit') || defaultUnit || '';
    if (!unit) errors.push('No unit.');
    else if (unit.length > 40) errors.push('The unit is longer than 40 characters.');
    const price = readPrice(read('price'), input.currency);
    if ('error' in price) errors.push(price.error);
    const currency = read('currency').toUpperCase();
    if (currency && currency !== input.currency) errors.push(`Priced in ${currency}; this price book is in ${input.currency}.`);
    const sourceId = read('source_id');
    let key = sourceId ? `${namespace}:id:item:${sourceId}` : `${namespace}:row:item:${createHash('sha256').update(JSON.stringify(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')}`;
    const repeat = seen.get(key) ?? 0;
    seen.set(key, repeat + 1);
    if (repeat) key = `${key}#${repeat}`;
    return { key, raw, normalized: { name, unit, unit_amount_minor: 'minor' in price ? price.minor : null, currency }, validation_errors: errors, hold: false };
  });
}

export type PriceBookInspection = {
  rowCount: number;
  columns: ColumnProfile[];
  plan: PriceBookPlan;
  origin: PlanOrigin;
  currency: string;
  /** Rows that can be staged as items, rows that cannot, and why. */
  summary: { ready: number; invalid: number; issues: Record<string, number> };
  preview: PriceRow[];
};

const PREVIEW_ROWS = 12;

/** Inspects parsed rows as price book items. The plan is the caller's, else a saved plan that still fits, else the suggested columns. */
export function inspectPriceBookRows(
  parsed: { headers: string[]; rows: Record<string, string>[] },
  input: { currency: string; sourceName?: string; plan?: PriceBookPlan; saved?: PriceBookPlan | null },
): PriceBookInspection {
  const rows = expandRows(parsed.rows);
  const columns = discoverSource(rows, parsed.headers).columns;
  const names = columns.map((column) => column.name);
  let origin: PlanOrigin = 'rules';
  let plan: PriceBookPlan | null = null;
  if (input.plan) { plan = validatePriceBookPlan(input.plan, names); origin = 'chosen'; }
  else if (input.saved) {
    try { plan = validatePriceBookPlan(input.saved, names); origin = 'saved'; }
    catch (error) { if (!(error instanceof DomainError)) throw error; }
  }
  // The suggested plan may still lack a name, a price or a unit; the person completes it before staging.
  plan = { ...(plan ?? { version: 1, mapping: suggestPriceMapping(names), defaultUnit: null }), signature: sourceSignature(parsed.headers) };
  const staged = priceRowsForPlan(rows, { sourceName: input.sourceName ?? '', plan, currency: input.currency });
  const issues: Record<string, number> = {};
  for (const row of staged) for (const error of row.validation_errors) issues[error] = (issues[error] ?? 0) + 1;
  const invalid = staged.filter((row) => row.validation_errors.length).length;
  return { rowCount: rows.length, columns, plan, origin, currency: input.currency, summary: { ready: staged.length - invalid, invalid, issues }, preview: staged.slice(0, PREVIEW_ROWS) };
}

/** The currency a business prices in; a price book import cannot start without it. */
export async function businessCurrency(db: Db, organizationId: string): Promise<string> {
  const { data, error } = await db.from('organizations').select('currency').eq('id', organizationId).maybeSingle();
  if (error || !data) throw new DomainError('That business could not be read.', 'integrations.forbidden');
  if (!data.currency) throw new DomainError('Set the currency this business trades in before importing prices.', 'integrations.currency_missing');
  return data.currency;
}

/** Inspects a saved import source as price book items, under the caller's own session. Writes nothing. */
export async function inspectPriceBookSource(db: Db, input: { organizationId: string; resourceId: string; plan?: PriceBookPlan }): Promise<PriceBookInspection> {
  await requireActor(db);
  const parsed = await downloadImportFile(db, { organizationId: input.organizationId, resourceId: input.resourceId });
  if (!parsed) throw new DomainError('That source has no rows to read.', 'integrations.file_missing');
  const currency = await businessCurrency(db, input.organizationId);
  const saved = input.plan ? null : await findSavedPlan<PriceBookPlan>(db, { organizationId: input.organizationId, signature: sourceSignature(parsed.headers), kind: 'price_book' });
  return inspectPriceBookRows(parsed, { currency, plan: input.plan, saved });
}
