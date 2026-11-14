import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createContact, deleteContact, getContact } from '@/lib/domain/contacts/contacts';
import { uploadImportFile } from '@/lib/domain/integrations/resources';
import { createMapping, type MappingField } from '@/lib/domain/integrations/mappings';
import {
  applyImportRun, beginImportRun, decideImportRow, getImportRun, listStagingRows, resumeImportStaging, skipUndecidedImportRows,
} from '@/lib/domain/integrations/import-runs';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `import-match-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db, userId: user.data.user.id };
}
const FIELDS: MappingField[] = [
  { sourceColumn: 'name', target: { kind: 'core', field: 'name' }, transform: 'none' },
  { sourceColumn: 'email', target: { kind: 'core', field: 'email' }, transform: 'trim_lowercase' },
  { sourceColumn: 'phone', target: { kind: 'core', field: 'phone' }, transform: 'e164' },
];

/**
 * Contact import matching and review: the source's stable ID first, then a normalized email; a
 * phone number only ever holds a row for a person to decide; a name alone never matches. Repeated
 * imports and contacts that appear after review never become duplicate identities.
 */
describe('contact import matching and review under real PostgreSQL', () => {
  let ownerId: string;
  let owner: Awaited<ReturnType<typeof account>>, viewer: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>;
  let organizationId: string, otherOrg: string;
  const tag = randomUUID().slice(0, 6);
  const mail = (local: string) => `${local}.${tag}@match.test`;
  const phone = (last: number) => `+1647555${String(1000 + last).padStart(4, '0')}`;

  beforeAll(async () => {
    [owner, viewer, outsider] = await Promise.all([account(), account(), account()]);
    ownerId = owner.userId;
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Import matching', currency: 'CAD', timezone: 'UTC' });
    otherOrg = await foundBusiness({ ownerEmail: outsider.email, name: 'Other importer', currency: 'CAD', timezone: 'UTC' });
    const role = await createRole(owner.db, { organizationId, name: 'Contact viewer', capabilities: ['customer.update'] });
    await addMember(owner.db, { organizationId, email: viewer.email, roleId: role });
  });

  async function stage(csv: string, { fileName = `match-${randomUUID().slice(0, 6)}.csv`, dedupeKey = 'email' as string | null } = {}) {
    const { resourceId } = await uploadImportFile(owner.db, { files: supabaseFileStore(owner.db, BUCKET), organizationId, file: new File([csv], fileName, { type: 'text/csv' }) });
    const mappingId = await createMapping(owner.db, { organizationId, resourceId, fields: FIELDS, dedupeKey });
    const runId = await beginImportRun(owner.db, { organizationId, mappingId });
    await resumeImportStaging(owner.db, { organizationId, runId });
    const rows = await listStagingRows(owner.db, { organizationId, runId });
    const row = (name: string) => rows.find(candidate => (candidate.normalized as { name?: string }).name === name)!;
    return { runId, rows, row };
  }
  const contactsNamed = async (name: string) => (await owner.db.from('contacts').select('id').eq('organization_id', organizationId).eq('name', name)).data ?? [];

  it('re-importing the same CSV creates no one twice, with or without a stable ID column', async () => {
    const plain = ['name,email,phone', `Ana ${tag},${mail('ana')},`, `Ben ${tag},,${phone(1)}`, `Cy ${tag},,`].join('\n');
    const first = await stage(plain, { fileName: `people-${tag}.csv` });
    expect(first.rows.map(row => row.proposedAction)).toEqual(['create', 'create', 'create']);
    await applyImportRun(owner.db, { organizationId, runId: first.runId });

    const again = await stage(plain, { fileName: `people-${tag}.csv` });
    expect(again.rows.map(row => [row.proposedAction, row.matchReason])).toEqual([['update', 'source'], ['update', 'source'], ['update', 'source']]);
    await applyImportRun(owner.db, { organizationId, runId: again.runId });
    expect(await getImportRun(owner.db, { organizationId, runId: again.runId })).toMatchObject({ rowsCreated: 0, rowsUpdated: 3 });
    for (const name of [`Ana ${tag}`, `Ben ${tag}`, `Cy ${tag}`]) expect(await contactsNamed(name)).toHaveLength(1);

    // With a stable ID column, a changed row is still the same record.
    const withId = (city: string) => ['source_record_id,name,email,phone', `D-1,Dee ${tag} ${city},${mail('dee')},`].join('\n');
    const original = await stage(withId('North'), { fileName: `ids-${tag}.csv` });
    await applyImportRun(owner.db, { organizationId, runId: original.runId });
    const changed = await stage(withId('South'), { fileName: `ids-${tag}.csv` });
    expect(changed.rows[0]).toMatchObject({ proposedAction: 'update', matchReason: 'source' });
    await applyImportRun(owner.db, { organizationId, runId: changed.runId });
    expect(await contactsNamed(`Dee ${tag} North`)).toHaveLength(0);
    expect(await contactsNamed(`Dee ${tag} South`)).toHaveLength(1);
  });

  it('holds a row whose source ID came from another file only when its name or email agrees', async () => {
    const first = await stage(['source_record_id,name,email,phone', `7,Gil ${tag},,${phone(7)}`].join('\n'));
    await applyImportRun(owner.db, { organizationId, runId: first.runId });
    const gil = (await contactsNamed(`Gil ${tag}`))[0].id;
    // The same record in a renamed file: held for a person, never created again.
    const renamed = await stage(['source_record_id,name,email,phone', `7,Gil ${tag},,`].join('\n'));
    expect(renamed.rows[0]).toMatchObject({ status: 'review', matchReason: 'source_other_file', candidateIds: [gil] });
    // Another file that happens to number a different person 7: nothing in common, so not held.
    const unrelated = await stage(['source_record_id,name,email,phone', `7,Hal ${tag},,`].join('\n'));
    expect(unrelated.rows[0]).toMatchObject({ status: 'ready', proposedAction: 'create', matchReason: null });
  });

  it('a renamed copy of the file matches by email, holds a row it imported before for review, and never creates either again', async () => {
    // Ana matches by email. Ben is the same row as in the first file, which a renamed file cannot be linked
    // to by its source key, so it is held as imported before from another file. Bo is new in this file and
    // shares only Ben's number: a phone number is evidence, so it is held too, never merged or created.
    const copy = await stage(['name,email,phone', `Ana ${tag},${mail('ANA')},`, `Ben ${tag},,${phone(1)}`, `Bo ${tag},,${phone(1)}`].join('\n'));
    expect(copy.row(`Ana ${tag}`)).toMatchObject({ status: 'ready', proposedAction: 'update', matchReason: 'email' });
    const ben = (await contactsNamed(`Ben ${tag}`))[0].id;
    expect(copy.row(`Ben ${tag}`)).toMatchObject({ status: 'review', proposedAction: 'review', matchReason: 'source_other_file', candidateIds: [ben] });
    expect(copy.row(`Bo ${tag}`)).toMatchObject({ status: 'review', proposedAction: 'review', matchReason: 'phone', candidateIds: [ben] });
    await expect(applyImportRun(owner.db, { organizationId, runId: copy.runId })).rejects.toThrow('Decide every row marked Needs review before importing.');
    await decideImportRow(owner.db, { organizationId, runId: copy.runId, rowId: copy.row(`Ben ${tag}`).id, decision: 'update', customerId: ben });
    await decideImportRow(owner.db, { organizationId, runId: copy.runId, rowId: copy.row(`Bo ${tag}`).id, decision: 'skip' });
    await applyImportRun(owner.db, { organizationId, runId: copy.runId });
    expect(await getImportRun(owner.db, { organizationId, runId: copy.runId })).toMatchObject({ rowsCreated: 0, rowsUpdated: 2, rowsSkipped: 1 });
    expect(await contactsNamed(`Ben ${tag}`)).toHaveLength(1);
    expect(await contactsNamed(`Bo ${tag}`)).toHaveLength(0);
  });

  it('matching an existing contact by email updates that one contact, keeping its identity and its type, and records the match', async () => {
    const existing = await createContact(owner.db, { organizationId, name: `Eve Original ${tag}`, email: mail('eve'), contactType: 'person' });
    const run = await stage(['name,email,phone', `Eve Renamed ${tag},${mail('eve')},${phone(2)}`].join('\n'));
    expect(run.rows[0]).toMatchObject({ proposedAction: 'update', matchedCustomerId: existing, matchReason: 'email' });
    await applyImportRun(owner.db, { organizationId, runId: run.runId });
    expect(await getContact(owner.db, { organizationId, customerId: existing })).toMatchObject({ id: existing, name: `Eve Renamed ${tag}`, email: mail('eve'), phone: phone(2), contactType: 'person' });
    expect(await contactsNamed(`Eve Renamed ${tag}`)).toHaveLength(1);
    const event = await owner.db.from('events').select('payload').eq('organization_id', organizationId).eq('entity_id', existing).eq('action', 'customer.import_matched').single();
    expect(event.data?.payload).toMatchObject({ run_id: run.runId, match: 'email', decided_by: null });
  });

  it('holds a row for review when several contacts share its email, or when the mapping does not trust email', async () => {
    // Older records can hold one address written two ways; normalized, they are the same email.
    const one = await createContact(owner.db, { organizationId, name: `One ${tag}`, email: mail('shared'), contactType: 'person' });
    const pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
    let two: string;
    try {
      await pg.query('begin');
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: 'authenticated' })]);
      two = (await pg.query("insert into contacts(organization_id,name,email,created_by) values($1,$2,$3,$4) returning id", [organizationId, `Two ${tag}`, ` ${mail('shared')} `, ownerId])).rows[0].id;
      await pg.query('commit');
    } finally { await pg.end(); }
    const shared = await stage(['name,email,phone', `Shared ${tag},${mail('shared')},`].join('\n'));
    expect(shared.rows[0]).toMatchObject({ status: 'review', matchReason: 'email_shared' });
    expect([...shared.rows[0].candidateIds].sort()).toEqual([one, two].sort());
    // One email is one contact: a second can never be created for it, so Create is refused here.
    await expect(decideImportRow(owner.db, { organizationId, runId: shared.runId, rowId: shared.rows[0].id, decision: 'create' })).rejects.toThrow('A contact already has this email. Update that contact or skip this row.');
    await decideImportRow(owner.db, { organizationId, runId: shared.runId, rowId: shared.rows[0].id, decision: 'update', customerId: one });
    expect((await listStagingRows(owner.db, { organizationId, runId: shared.runId }))[0]).toMatchObject({ status: 'ready', proposedAction: 'update', matchedCustomerId: one, decided: true });

    const solo = await createContact(owner.db, { organizationId, name: `Solo ${tag}`, email: mail('solo'), contactType: 'person' });
    const untrusted = await stage(['name,email,phone', `Solo Again ${tag},${mail('solo')},`].join('\n'), { dedupeKey: null });
    expect(untrusted.rows[0]).toMatchObject({ status: 'review', matchReason: 'email_unconfirmed', candidateIds: [solo] });
  });

  it('treats a phone number as evidence only: a shared office line, or a row with no email, is decided by a person', async () => {
    const desk = await createContact(owner.db, { organizationId, name: `Front Desk ${tag}`, phone: phone(10), contactType: 'company' });
    await createContact(owner.db, { organizationId, name: `Rae ${tag}`, email: mail('rae'), phone: phone(11), contactType: 'person' });
    const run = await stage(['name,email,phone',
      `Jordan ${tag},,${phone(10)}`, // no email: might be the front desk
      `Sam ${tag},${mail('sam')},${phone(10)}`, // has an email, but the desk has none to tell them apart
      `Kai ${tag},${mail('kai')},${phone(11)}`, // a different email from Rae on Rae's line: a colleague
      `Lee ${tag},,${phone(12)}`, `Lou ${tag},,${phone(12)}`, // two rows of this file on one new number
      `Pat Smith ${tag},,`, `Pat Smith ${tag} copy,,`, // names alone never match anything
    ].join('\n'));
    expect(run.row(`Jordan ${tag}`)).toMatchObject({ status: 'review', matchReason: 'phone', candidateIds: [desk] });
    expect(run.row(`Sam ${tag}`)).toMatchObject({ status: 'review', matchReason: 'phone', candidateIds: [desk] });
    expect(run.row(`Kai ${tag}`)).toMatchObject({ status: 'ready', proposedAction: 'create', matchReason: null, candidateIds: [] });
    expect(run.row(`Lee ${tag}`)).toMatchObject({ status: 'ready', proposedAction: 'create' });
    expect(run.row(`Lou ${tag}`)).toMatchObject({ status: 'review', matchReason: 'phone_in_file', candidateIds: [] });
    expect(run.row(`Pat Smith ${tag}`)).toMatchObject({ status: 'ready', proposedAction: 'create', candidateIds: [] });

    // Only one of the contacts it might be can be chosen, and only someone who runs imports decides.
    await expect(decideImportRow(owner.db, { organizationId, runId: run.runId, rowId: run.row(`Jordan ${tag}`).id, decision: 'update', customerId: run.row(`Pat Smith ${tag}`).id })).rejects.toThrow('Choose one of the matching contacts.');
    await expect(decideImportRow(viewer.db, { organizationId, runId: run.runId, rowId: run.row(`Jordan ${tag}`).id, decision: 'skip' })).rejects.toThrow('You cannot run imports here.');
    await expect(decideImportRow(outsider.db, { organizationId, runId: run.runId, rowId: run.row(`Jordan ${tag}`).id, decision: 'skip' })).rejects.toThrow('You cannot run imports here.');
    await expect(decideImportRow(outsider.db, { organizationId: otherOrg, runId: run.runId, rowId: run.row(`Jordan ${tag}`).id, decision: 'skip' })).rejects.toThrow();

    await decideImportRow(owner.db, { organizationId, runId: run.runId, rowId: run.row(`Sam ${tag}`).id, decision: 'create' });
    expect(await skipUndecidedImportRows(owner.db, { organizationId, runId: run.runId })).toBe(2);
    const decided = await listStagingRows(owner.db, { organizationId, runId: run.runId });
    expect(decided.filter(row => row.status === 'review')).toEqual([]);
    expect(decided.find(row => row.id === run.row(`Jordan ${tag}`).id)).toMatchObject({ status: 'ignored', decided: true });
    await applyImportRun(owner.db, { organizationId, runId: run.runId });
    expect(await getImportRun(owner.db, { organizationId, runId: run.runId })).toMatchObject({ rowsCreated: 5, rowsUpdated: 0, rowsSkipped: 2 });
    expect(await contactsNamed(`Jordan ${tag}`)).toHaveLength(0);
    expect(await contactsNamed(`Sam ${tag}`)).toHaveLength(1);
    expect(await getContact(owner.db, { organizationId, customerId: desk })).toMatchObject({ name: `Front Desk ${tag}`, email: null });
  });

  it('skips a repeat of an earlier row of the same file, and never updates one contact twice from one file', async () => {
    const zed = await createContact(owner.db, { organizationId, name: `Zed ${tag}`, email: mail('zed'), contactType: 'person' });
    const run = await stage(['name,email,phone', `Max ${tag},${mail('max')},`, `Max Again ${tag},${mail('MAX')},`, `Zed ${tag},${mail('zed')},`, `Zed Again ${tag},${mail('zed')},`].join('\n'));
    expect(run.row(`Max Again ${tag}`)).toMatchObject({ status: 'duplicate', matchReason: 'email_in_file' });
    expect(run.row(`Zed ${tag}`)).toMatchObject({ status: 'ready', matchedCustomerId: zed });
    expect(run.row(`Zed Again ${tag}`)).toMatchObject({ status: 'duplicate', matchReason: 'email_in_file' });
  });

  it('does not create a contact that appeared after review, but keeps a person’s explicit Create', async () => {
    const run = await stage(['name,email,phone', `Late ${tag},${mail('late')},`, `Twin ${tag},,${phone(20)}`, `Chosen ${tag},,${phone(21)}`].join('\n'));
    expect(run.rows.map(row => row.proposedAction)).toEqual(['create', 'create', 'create']);
    // Someone adds the same people by hand before the import is applied.
    await createContact(owner.db, { organizationId, name: `Late by hand ${tag}`, email: mail('late'), contactType: 'person' });
    await createContact(owner.db, { organizationId, name: `Twin by hand ${tag}`, phone: phone(20), contactType: 'person' });
    await createContact(owner.db, { organizationId, name: `Chosen by hand ${tag}`, phone: phone(21), contactType: 'person' });
    await decideImportRow(owner.db, { organizationId, runId: run.runId, rowId: run.row(`Chosen ${tag}`).id, decision: 'create' });
    await applyImportRun(owner.db, { organizationId, runId: run.runId });
    const after = await listStagingRows(owner.db, { organizationId, runId: run.runId });
    expect(after.find(row => row.id === run.row(`Late ${tag}`).id)).toMatchObject({ status: 'failed' });
    expect(after.find(row => row.id === run.row(`Late ${tag}`).id)!.validationErrors.join(' ')).toContain('A contact with this email was added after this import was reviewed.');
    expect(after.find(row => row.id === run.row(`Twin ${tag}`).id)!.validationErrors.join(' ')).toContain('A contact with this phone number was added after this import was reviewed.');
    expect(after.find(row => row.id === run.row(`Chosen ${tag}`).id)).toMatchObject({ status: 'applied' });
    expect(await contactsNamed(`Late ${tag}`)).toHaveLength(0);
    expect(await contactsNamed(`Twin ${tag}`)).toHaveLength(0);
    expect(await getImportRun(owner.db, { organizationId, runId: run.runId })).toMatchObject({ rowsCreated: 1, rowsFailed: 2 });
  });

  it('never turns a row linked by its source ID into a new contact', async () => {
    const csv = ['source_record_id,name,email,phone', `L-1,Linked ${tag},,`].join('\n');
    const first = await stage(csv, { fileName: `linked-${tag}.csv` });
    await applyImportRun(owner.db, { organizationId, runId: first.runId });
    const again = await stage(csv, { fileName: `linked-${tag}.csv` });
    const row = again.rows[0];
    expect(row).toMatchObject({ matchReason: 'source', proposedAction: 'update' });
    await expect(decideImportRow(owner.db, { organizationId, runId: again.runId, rowId: row.id, decision: 'create' })).rejects.toThrow('This row is already linked to its contact by the source ID.');
    await decideImportRow(owner.db, { organizationId, runId: again.runId, rowId: row.id, decision: 'skip' });
    await decideImportRow(owner.db, { organizationId, runId: again.runId, rowId: row.id, decision: 'update', customerId: row.matchedCustomerId });
    await applyImportRun(owner.db, { organizationId, runId: again.runId });
    expect(await contactsNamed(`Linked ${tag}`)).toHaveLength(1);
    // Once applied, a run's decisions are history.
    await expect(decideImportRow(owner.db, { organizationId, runId: again.runId, rowId: row.id, decision: 'skip' })).rejects.toThrow('This import has already been applied.');
  });

  it('deleting an imported contact keeps the source link as evidence without their details, and a later import of the same record is held, not re-created', async () => {
    const csv = ['source_record_id,name,email,phone', `X-9,Gone Gus ${tag},${mail('gus')},`].join('\n');
    const fileName = `deleted-${tag}.csv`;
    const first = await stage(csv, { fileName });
    await applyImportRun(owner.db, { organizationId, runId: first.runId });
    const gus = (await contactsNamed(`Gone Gus ${tag}`))[0].id;
    await deleteContact(owner.db, { organizationId, contactId: gus });
    const evidence = await (async () => {
      const pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
      try {
        return {
          link: (await pg.query("select gold_entity_id, contact_deleted_at is not null as deleted from external_record_links where organization_id = $1 and gold_entity_id = $2", [organizationId, gus])).rows,
          row: (await pg.query('select status, raw, normalized, matched_customer_id from import_staging_rows where organization_id = $1 and run_id = $2', [organizationId, first.runId])).rows,
        };
      } finally { await pg.end(); }
    })();
    expect(evidence.link).toEqual([{ gold_entity_id: gus, deleted: true }]);
    expect(evidence.row).toEqual([{ status: 'applied', raw: {}, normalized: {}, matched_customer_id: null }]);
    // The same record again: held for a person, never quietly added back.
    const again = await stage(csv, { fileName });
    expect(again.rows[0]).toMatchObject({ status: 'review', proposedAction: 'review', matchReason: 'source_deleted', candidateIds: [] });
    await expect(applyImportRun(owner.db, { organizationId, runId: again.runId })).rejects.toThrow('Decide every row marked Needs review before importing.');
    await decideImportRow(owner.db, { organizationId, runId: again.runId, rowId: again.rows[0].id, decision: 'skip' });
    await applyImportRun(owner.db, { organizationId, runId: again.runId });
    expect(await contactsNamed(`Gone Gus ${tag}`)).toEqual([]);
    // A person may still bring them back on purpose; the source link then follows the new contact.
    const deliberately = await stage(csv, { fileName });
    await decideImportRow(owner.db, { organizationId, runId: deliberately.runId, rowId: deliberately.rows[0].id, decision: 'create' });
    await applyImportRun(owner.db, { organizationId, runId: deliberately.runId });
    const back = await contactsNamed(`Gone Gus ${tag}`);
    expect(back).toHaveLength(1);
    const relinked = await (async () => { const pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect(); try { return (await pg.query("select gold_entity_id, contact_deleted_at from external_record_links where organization_id = $1 and external_record_id = $2", [organizationId, deliberately.rows[0].sourceRecordKey])).rows; } finally { await pg.end(); } })();
    expect(relinked).toEqual([{ gold_entity_id: back[0].id, contact_deleted_at: null }]);
  });
});
