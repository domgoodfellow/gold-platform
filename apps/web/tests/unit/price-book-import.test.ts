import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/domain/files/parsers/csv';
import { importDestination, libraryNewImportHref } from '@/lib/route/library';
import { inspectPriceBookRows, priceRowsForPlan, readPrice, suggestPriceMapping, validatePriceBookPlan, type PriceBookPlan } from '@/lib/domain/integrations/translation/price-book';
import { sourceSignature } from '@/lib/domain/integrations/translation/plan';

/**
 * Reading a source as price book items, without a database: which columns are suggested, how a
 * price becomes minor units of the business's currency, which rows are left out and why, and that
 * row keys stay stable. Matching and applying are proven in
 * `tests/integration/database/price-book-import.test.ts`.
 */

describe('reading a price', () => {
  it('reads symbols, codes and thousands separators into minor units of the business currency', () => {
    expect(readPrice('$1,250.00', 'CAD')).toEqual({ minor: 125000 });
    expect(readPrice('CA$ 45.5', 'CAD')).toEqual({ minor: 4550 });
    expect(readPrice('45.50 CAD', 'CAD')).toEqual({ minor: 4550 });
    expect(readPrice('0', 'CAD')).toEqual({ minor: 0 });
    expect(readPrice('1200', 'JPY')).toEqual({ minor: 1200 });
  });

  it('refuses what it cannot read for certain instead of guessing', () => {
    expect(readPrice('12,50', 'CAD')).toMatchObject({ error: expect.stringMatching(/two ways/) });
    expect(readPrice('-5', 'CAD')).toEqual({ error: 'A price cannot be negative.' });
    expect(readPrice('Varies', 'CAD')).toMatchObject({ error: expect.stringMatching(/not a price/) });
    expect(readPrice('1.234', 'CAD')).toMatchObject({ error: expect.stringMatching(/not a price/) });
    expect(readPrice('', 'CAD')).toEqual({ error: 'No price.' });
  });
});

describe('suggested columns', () => {
  it('reads an accounting export and a plain sheet by their own words', () => {
    expect(suggestPriceMapping(['Product/Service Name', 'Sales Description', 'SKU', 'Sales Price / Rate', 'Purchase Cost'])).toEqual({ item_name: 'Product/Service Name', price: 'Sales Price / Rate', source_id: 'SKU' });
    expect(suggestPriceMapping(['Name', 'Rate', 'Per', 'ID'])).toEqual({ item_name: 'Name', price: 'Rate', unit: 'Per', source_id: 'ID' });
    expect(suggestPriceMapping(['Item', 'api_key'])).toEqual({ item_name: 'Item' });
  });
});

describe('a price book plan', () => {
  const columns = ['Item', 'Price', 'Unit', 'SKU', 'Currency'];
  it('needs a name, a price and a unit, from a column or for every row', () => {
    expect(() => validatePriceBookPlan({ version: 1, mapping: { price: 'Price', unit: 'Unit' }, defaultUnit: null }, columns)).toThrow(/item name/);
    expect(() => validatePriceBookPlan({ version: 1, mapping: { item_name: 'Item', unit: 'Unit' }, defaultUnit: null }, columns)).toThrow(/price/);
    expect(() => validatePriceBookPlan({ version: 1, mapping: { item_name: 'Item', price: 'Price' }, defaultUnit: null }, columns)).toThrow(/unit/);
    expect(() => validatePriceBookPlan({ version: 1, mapping: { item_name: 'Item', price: 'Item' }, defaultUnit: 'each' }, columns)).toThrow(/one value/);
    expect(() => validatePriceBookPlan({ version: 1, mapping: { item_name: 'Gone', price: 'Price' }, defaultUnit: 'each' }, columns)).toThrow(/no column/);
    expect(validatePriceBookPlan({ version: 1, mapping: { item_name: 'Item', price: 'Price' }, defaultUnit: ' visit ' }, columns)).toEqual({ version: 1, mapping: { item_name: 'Item', price: 'Price' }, defaultUnit: 'visit' });
  });

  it('leaves out rows without a name or price, priced in another currency, and uses the default unit where a row names none', () => {
    const plan: PriceBookPlan = { version: 1, mapping: { item_name: 'Item', price: 'Price', unit: 'Unit', currency: 'Currency' }, defaultUnit: 'each' };
    const rows = priceRowsForPlan([
      { Item: 'Callout', Price: '125', Unit: '', Currency: 'cad' },
      { Item: '', Price: '10', Unit: 'hour', Currency: '' },
      { Item: 'Imported part', Price: '30', Unit: 'each', Currency: 'USD' },
    ], { sourceName: 'items.csv', plan, currency: 'CAD' });
    expect(rows[0]).toMatchObject({ normalized: { name: 'Callout', unit: 'each', unit_amount_minor: 12500 }, validation_errors: [] });
    expect(rows[1].validation_errors).toEqual(['No item name.']);
    expect(rows[2].validation_errors).toEqual(['Priced in USD; this price book is in CAD.']);
  });

  it('keys a row by its source ID, else by its content, and tells identical rows apart', () => {
    const withId: PriceBookPlan = { version: 1, mapping: { item_name: 'Item', price: 'Price', source_id: 'SKU' }, defaultUnit: 'each' };
    const [keyed] = priceRowsForPlan([{ Item: 'Callout', Price: '1', SKU: 'S1' }], { sourceName: 'a.csv', plan: withId, currency: 'CAD' });
    expect(keyed.key).toMatch(/:id:item:S1$/);
    const plain: PriceBookPlan = { version: 1, mapping: { item_name: 'Item', price: 'Price' }, defaultUnit: 'each' };
    const twice = priceRowsForPlan([{ Item: 'Callout', Price: '1' }, { Item: 'Callout', Price: '1' }], { sourceName: 'a.csv', plan: plain, currency: 'CAD' });
    expect(twice[1].key).toBe(`${twice[0].key}#1`);
    expect(priceRowsForPlan([{ Price: '1', Item: 'Callout' }], { sourceName: 'a.csv', plan: plain, currency: 'CAD' })[0].key).toBe(twice[0].key);
  });
});

describe('inspecting a price list', () => {
  const parsed = parseCsv('Item,Price,Per\nCallout,125,visit\nSurvey,Varies,visit');
  it('starts from the suggested columns, then from a saved plan that still fits', () => {
    const fresh = inspectPriceBookRows(parsed, { currency: 'CAD' });
    expect(fresh).toMatchObject({ origin: 'rules', plan: { mapping: { item_name: 'Item', price: 'Price', unit: 'Per' }, signature: sourceSignature(parsed.headers) }, summary: { ready: 1, invalid: 1 } });
    const saved = inspectPriceBookRows(parsed, { currency: 'CAD', saved: { version: 1, mapping: { item_name: 'Item', price: 'Price' }, defaultUnit: 'hour' } });
    expect(saved).toMatchObject({ origin: 'saved', plan: { defaultUnit: 'hour' } });
    expect(inspectPriceBookRows(parsed, { currency: 'CAD', saved: { version: 1, mapping: { item_name: 'Gone', price: 'Price' }, defaultUnit: 'hour' } }).origin).toBe('rules');
  });
});

describe('the import destination', () => {
  it('is Contacts unless the price book is named, and travels in the import link', () => {
    expect(importDestination('price_book')).toBe('price_book');
    expect(importDestination(undefined)).toBe('contacts');
    expect(libraryNewImportHref('org', 'res', 'price_book')).toBe('/organizations/org/library/imports/new?resourceId=res&into=price_book');
    expect(libraryNewImportHref('org', 'res')).toBe('/organizations/org/library/imports/new?resourceId=res');
    expect(libraryNewImportHref('org')).toBe('/organizations/org/library/imports/new');
  });
});
