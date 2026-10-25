import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createContact, getContact, listContactPage, updateContact } from '@/lib/domain/contacts/contacts';
import { uploadImportFile } from '@/lib/domain/integrations/resources';
import { createMapping, type MappingField } from '@/lib/domain/integrations/mappings';
import { applyImportRun, beginImportRun, listStagingRows, stageRows } from '@/lib/domain/integrations/import-runs';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { parseCsv } from '@/lib/domain/files/parsers/csv';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `lifecycle-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db };
}
const core = (sourceColumn: string, field: 'name' | 'email' | 'lifecycle'): MappingField => ({ sourceColumn, target: { kind: 'core', field }, transform: field === 'email' ? 'trim_lowercase' : 'none' });

/**
 * V1.4: a newly created contact is not necessarily a Lead. Manual creation keeps the lifecycle that
 * was chosen, or none. An import resolves a new row as row-level mapped value, else the reviewer's
 * source-wide default for new rows, else Unclassified; invalid values are surfaced, and a default
 * never changes a contact that already exists.
 */
describe('contact lifecycle defaults under real PostgreSQL', () => {
  let owner: Awaited<ReturnType<typeof account>>; let organizationId: string;
  beforeAll(async () => {
    owner = await account();
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Lifecycle defaults', currency: 'CAD', timezone: 'UTC' });
  });

  it('manual creation stores no lifecycle unless one is chosen, and leaves temperature Unrated', async () => {
    const plain = await createContact(owner.db, { organizationId, name: 'Plain Person', contactType: 'person' });
    const company = await createContact(owner.db, { organizationId, name: 'Plain Company', contactType: 'company' });
    const chosen = await createContact(owner.db, { organizationId, name: 'Chosen Prospect', contactType: 'person', lifecycle: 'prospect' });
    for (const id of [plain, company]) expect(await getContact(owner.db, { organizationId, customerId: id })).toMatchObject({ lifecycle: null, leadTemperature: 'unrated' });
    expect((await getContact(owner.db, { organizationId, customerId: chosen }))?.lifecycle).toBe('prospect');
    // Classifying later is an ordinary, recorded update.
    await updateContact(owner.db, { organizationId, customerId: plain, name: 'Plain Person', contactType: 'person', lifecycle: 'customer' });
    expect((await getContact(owner.db, { organizationId, customerId: plain }))?.lifecycle).toBe('customer');
  });

  async function importCsv(csv: string, fields: MappingField[]) {
    // Each import has its own stable row keys, as a real CSV source does, so rows never match another import's rows by identity.
    const batch = randomUUID().slice(0, 8);
    const resourceId = (await uploadImportFile(owner.db, { files: supabaseFileStore(owner.db, BUCKET), organizationId, file: new File([csv], `life-${randomUUID().slice(0, 6)}.csv`, { type: 'text/csv' }) })).resourceId;
    const mappingId = await createMapping(owner.db, { organizationId, resourceId, fields, dedupeKey: 'email' });
    const runId = await beginImportRun(owner.db, { organizationId, mappingId });
    const definitions = await listFieldDefinitions(owner.db, { organizationId, entityType: 'customer' });
    await stageRows(owner.db, { organizationId, runId, mapping: fields, fieldDefinitions: definitions, sourceRows: parseCsv(csv).rows.map((raw, index) => ({ key: `${batch}:row-${index}`, raw })) });
    const staged = await listStagingRows(owner.db, { organizationId, runId });
    await applyImportRun(owner.db, { organizationId, runId });
    return staged;
  }
  const contactRow = async (email: string) => (await owner.db.from('contacts').select('lifecycle').eq('organization_id', organizationId).eq('email', email).maybeSingle()).data;
  const lifecycleOf = async (email: string) => { const row = await contactRow(email); return row ? row.lifecycle : 'missing'; };

  it('imports resolve row value, then source-wide default for new rows, then Unclassified, and never downgrade an existing contact', async () => {
    const existing = await createContact(owner.db, { organizationId, name: 'Existing Customer', email: 'existing@life.test', contactType: 'person', lifecycle: 'customer' });
    const csv = ['name,email,stage', 'Default Lead,default@life.test,', 'Row Customer,row@life.test,customer', 'Bad Value,bad@life.test,vip', 'Existing Customer,existing@life.test,'].join('\n');
    const staged = await importCsv(csv, [core('name', 'name'), core('email', 'email'), core('stage', 'lifecycle'),
      { sourceColumn: '__default_lifecycle', fixedValue: 'lead', target: { kind: 'core', field: 'default_lifecycle' }, transform: 'none' }]);

    const bad = staged.find(row => row.sourceRecordKey.endsWith(':row-2'))!;
    expect(bad.status).toBe('invalid');
    expect(bad.validationErrors.join(' ')).toContain('Invalid lifecycle: vip');
    expect(staged.find(row => row.sourceRecordKey.endsWith(':row-3'))).toMatchObject({ proposedAction: 'update', matchedCustomerId: existing });

    expect(await lifecycleOf('default@life.test')).toBe('lead');
    expect(await lifecycleOf('row@life.test')).toBe('customer');
    expect(await lifecycleOf('bad@life.test')).toBe('missing');
    expect(await lifecycleOf('existing@life.test')).toBe('customer');
  });

  it('a row-level lifecycle can still change an existing contact; without a default, new rows stay Unclassified', async () => {
    const csv = ['name,email,stage', 'Existing Customer,existing@life.test,prospect', 'No Default,nodefault@life.test,'].join('\n');
    await importCsv(csv, [core('name', 'name'), core('email', 'email'), core('stage', 'lifecycle')]);
    expect(await lifecycleOf('existing@life.test')).toBe('prospect');
    expect(await lifecycleOf('nodefault@life.test')).toBeNull();
  });

  it('lists Unspecified or unclassified contacts in Needs review, with a total that matches its rows', async () => {
    const legacy = await createContact(owner.db, { organizationId, name: 'Legacy Unspecified', lifecycle: 'customer' });
    const page = await listContactPage(owner.db, { organizationId, filter: { page: 1, needsReview: true } });
    expect(page.total).toBe(page.length);
    expect(page.map(row => row.id)).toContain(legacy);
    expect(page.every(row => row.contactType === 'unspecified' || row.lifecycle === null)).toBe(true);
    const all = await listContactPage(owner.db, { organizationId, filter: { page: 1 } });
    expect(all.filter(row => row.contactType === 'unspecified' || row.lifecycle === null).map(row => row.id).sort()).toEqual(page.map(row => row.id).sort());
  });
});
