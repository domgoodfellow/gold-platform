import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { uploadImportFile } from '@/lib/domain/integrations/resources';
import { createMapping, priceBookMappingFields } from '@/lib/domain/integrations/mappings';
import { applyImportRun, beginImportRun, decideImportRow, getImportRun, listStagingRows, resumeImportStaging } from '@/lib/domain/integrations/import-runs';
import { inspectPriceBookSource, validatePriceBookPlan } from '@/lib/domain/integrations/translation/price-book';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `price-import-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db };
}

// An accounting-style item export: its own words for name, price and ID.
const HEADERS = 'Product/Service Name,Sales Price / Rate,Unit,SKU';

/**
 * A price book import under real PostgreSQL: a source's items are matched to the price book by
 * the source's ID or by name, new ones created and changed ones updated in the business's own
 * currency, bad and repeated rows left out, a repeat of the same columns starting from the saved
 * plan, contacts never touched, and nothing without both `integration.manage` and `price.manage`.
 */
describe('price book import under real PostgreSQL', () => {
  let owner: Awaited<ReturnType<typeof account>>, importer: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>;
  let organizationId: string;
  const tag = randomUUID().slice(0, 6);

  beforeAll(async () => {
    [owner, importer, outsider] = await Promise.all([account(), account(), account()]);
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Price import', currency: 'CAD', timezone: 'UTC' });
    await foundBusiness({ ownerEmail: outsider.email, name: 'Other price book', currency: 'CAD', timezone: 'UTC' });
    const role = await createRole(owner.db, { organizationId, name: 'Importer without prices', capabilities: ['integration.manage'] });
    await addMember(owner.db, { organizationId, email: importer.email, roleId: role });
  });

  async function stage(csv: string, { fileName = `items-${tag}.csv`, db = owner.db } = {}) {
    const { resourceId } = await uploadImportFile(db, { files: supabaseFileStore(db, BUCKET), organizationId, file: new File([csv], fileName, { type: 'text/csv' }) });
    const inspection = await inspectPriceBookSource(db, { organizationId, resourceId });
    const plan = validatePriceBookPlan(inspection.plan, inspection.columns.map((column) => column.name));
    const mappingId = await createMapping(db, { organizationId, resourceId, fields: priceBookMappingFields(plan) });
    const runId = await beginImportRun(db, { organizationId, mappingId });
    await resumeImportStaging(db, { organizationId, runId });
    const rows = await listStagingRows(db, { organizationId, runId });
    const row = (name: string) => rows.filter((candidate) => (candidate.normalized as { name?: string }).name === name);
    return { runId, rows, row, inspection };
  }
  const items = async () => (await owner.db.from('price_book_items').select('id,name,unit,unit_amount_minor,currency').eq('organization_id', organizationId).like('name', `%${tag}`).order('name')).data ?? [];

  it('creates the source’s items in the business’s currency and leaves out bad and repeated rows', async () => {
    const first = await stage([HEADERS,
      `Callout ${tag},$125.00,visit,S1`,
      `Hourly labour ${tag},"1,050.50",hour,S2`,
      `Survey ${tag},Varies,each,S3`,
      `Callout ${tag},130,visit,S4`,
    ].join('\n'));
    expect(first.inspection).toMatchObject({ origin: 'rules', currency: 'CAD', plan: { mapping: { item_name: 'Product/Service Name', price: 'Sales Price / Rate', unit: 'Unit', source_id: 'SKU' } } });
    // Rows staged together share a timestamp, so each is found by its source ID: the later Callout is the repeat.
    const bySku = (sku: string) => first.rows.find((row) => row.sourceRecordKey.endsWith(`:id:item:${sku}`))!;
    expect([bySku('S1'), bySku('S4')].map((row) => [row.status, row.matchReason])).toEqual([['ready', null], ['duplicate', 'name_in_file']]);
    expect(first.row(`Survey ${tag}`)[0]).toMatchObject({ status: 'invalid' });
    expect(first.row(`Survey ${tag}`)[0].validationErrors[0]).toMatch(/not a price/);

    await applyImportRun(owner.db, { organizationId, runId: first.runId });
    expect(await items()).toEqual([
      expect.objectContaining({ name: `Callout ${tag}`, unit: 'visit', unit_amount_minor: 12500, currency: 'CAD' }),
      expect.objectContaining({ name: `Hourly labour ${tag}`, unit: 'hour', unit_amount_minor: 105050, currency: 'CAD' }),
    ]);
    expect(await getImportRun(owner.db, { organizationId, runId: first.runId })).toMatchObject({ targetEntity: 'price_book_item', status: 'completed', rowsCreated: 2, rowsSkipped: 2 });
    expect((await owner.db.from('contacts').select('id').eq('organization_id', organizationId).like('name', `%${tag}`)).data).toEqual([]);
  });

  it('matches the next source by its ID or by name, updates what changed and skips what did not', async () => {
    const again = await stage([HEADERS,
      `Callout ${tag},140.00,visit,S1`,
      `Hourly labour ${tag},1050.50,hour,S9`,
      `Gutter clean ${tag},90,visit,S5`,
    ].join('\n'), { fileName: `items-${tag}.csv` });
    expect(again.inspection.origin).toBe('saved');
    expect(again.row(`Callout ${tag}`)[0]).toMatchObject({ status: 'ready', proposedAction: 'update', matchReason: 'source' });
    expect(again.row(`Hourly labour ${tag}`)[0]).toMatchObject({ status: 'ignored', proposedAction: 'skip', matchReason: 'name' });
    expect(again.row(`Gutter clean ${tag}`)[0]).toMatchObject({ status: 'ready', proposedAction: 'create' });

    const matched = again.row(`Hourly labour ${tag}`)[0];
    await expect(decideImportRow(owner.db, { organizationId, runId: again.runId, rowId: matched.id, decision: 'create' })).rejects.toThrow(/already has this name/);
    await decideImportRow(owner.db, { organizationId, runId: again.runId, rowId: again.row(`Gutter clean ${tag}`)[0].id, decision: 'skip' });

    await applyImportRun(owner.db, { organizationId, runId: again.runId });
    expect((await items()).map((item) => [item.name, item.unit_amount_minor])).toEqual([[`Callout ${tag}`, 14000], [`Hourly labour ${tag}`, 105050]]);
  });

  it('refuses without price.manage, never as contacts, and never across businesses', async () => {
    await expect(stage([HEADERS, `Refused ${tag},10,each,R1`].join('\n'), { fileName: `refused-${tag}.csv`, db: importer.db })).rejects.toThrow();
    expect((await owner.db.from('price_book_items').select('id').eq('organization_id', organizationId).eq('name', `Refused ${tag}`)).data).toEqual([]);

    const pending = await stage([HEADERS, `Direct ${tag},10,each,D1`].join('\n'), { fileName: `direct-${tag}.csv` });
    const direct = await owner.db.rpc('apply_contact_import_run' as never, { p_organization_id: organizationId, p_run_id: pending.runId } as never);
    expect(direct.error).not.toBeNull();
    expect((await owner.db.from('contacts').select('id').eq('organization_id', organizationId).eq('name', `Direct ${tag}`)).data).toEqual([]);

    const { resourceId } = await uploadImportFile(owner.db, { files: supabaseFileStore(owner.db, BUCKET), organizationId, file: new File([HEADERS], `mine-${tag}.csv`, { type: 'text/csv' }) });
    await expect(inspectPriceBookSource(outsider.db, { organizationId, resourceId })).rejects.toThrow();
  });
});
