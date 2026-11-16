import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { uploadImportFile } from '@/lib/domain/integrations/resources';
import { createMapping, prepareImportFields, translationMappingFields } from '@/lib/domain/integrations/mappings';
import { applyImportRun, beginImportRun, decideImportRow, getImportRun, listStagingRows, resumeImportStaging, rowTranslation } from '@/lib/domain/integrations/import-runs';
import { inspectImportSource } from '@/lib/domain/integrations/translation/inspect';
import { BUSINESS_FIELDS } from '@/lib/domain/integrations/translation/adapter';
import type { TranslationPlan } from '@/lib/domain/integrations/translation/plan';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `translated-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db, userId: user.data.user.id };
}

const META = (fields: Record<string, string>) => `"[NF_LEAD_META]${JSON.stringify(fields).replace(/"/g, '""')}[/NF_LEAD_META]"`;
const HEADERS = 'id,business_name,full_name,phone_e164,contact_email,website,industry,lead_status,notes';

/**
 * A translated import under real PostgreSQL: one source row becomes a business row and a person
 * row, the person is linked to the business when applied, rows the translation must confirm are
 * held until a person decides, the same source stages the same rows again and creates nobody
 * twice, and nothing crosses a business or runs without `integration.manage`.
 */
describe('translated contact import under real PostgreSQL', () => {
  let owner: Awaited<ReturnType<typeof account>>, viewer: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>;
  let organizationId: string, otherOrg: string;
  const tag = randomUUID().slice(0, 6);
  const phone = (last: number) => `+1647555${String(2000 + last).padStart(4, '0')}`;

  beforeAll(async () => {
    [owner, viewer, outsider] = await Promise.all([account(), account(), account()]);
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Translated import', currency: 'CAD', timezone: 'UTC' });
    otherOrg = await foundBusiness({ ownerEmail: outsider.email, name: 'Other importer', currency: 'CAD', timezone: 'UTC' });
    const role = await createRole(owner.db, { organizationId, name: 'Contact viewer', capabilities: ['customer.read', 'customer.update'] });
    await addMember(owner.db, { organizationId, email: viewer.email, roleId: role });
    await prepareImportFields(owner.db, organizationId, [], BUSINESS_FIELDS.map(([key]) => key));
  });

  async function stage(csv: string, { fileName = `translated-${randomUUID().slice(0, 6)}.csv`, patch = (plan: TranslationPlan) => plan, db = owner.db } = {}) {
    const { resourceId } = await uploadImportFile(db, { files: supabaseFileStore(db, BUCKET), organizationId, file: new File([csv], fileName, { type: 'text/csv' }) });
    const inspection = await inspectImportSource(db, { organizationId, resourceId });
    const plan = patch(inspection.plan);
    const mappingId = await createMapping(db, { organizationId, resourceId, fields: translationMappingFields(plan), dedupeKey: 'email' });
    const runId = await beginImportRun(db, { organizationId, mappingId });
    await resumeImportStaging(db, { organizationId, runId });
    const rows = await listStagingRows(db, { organizationId, runId });
    const row = (name: string) => rows.find(candidate => (candidate.normalized as { name?: string }).name === name)!;
    return { resourceId, runId, rows, row, inspection };
  }
  const contactsNamed = async (name: string) => (await owner.db.from('contacts').select('id,contact_type,phone,email,custom').eq('organization_id', organizationId).eq('name', name)).data ?? [];
  const affiliationsOf = async (personId: string) => (await owner.db.from('contact_affiliations').select('company_id,title,active').eq('organization_id', organizationId).eq('person_id', personId)).data ?? [];

  it('stages a business and its people as their own rows and links them when applied', async () => {
    const csv = [HEADERS,
      `a1,Ackerman Painting ${tag},Chris Ackerman ${tag},${phone(1)},chris.${tag}@ackerman.test,ackerman-${tag}.example,Painters,NEW,${META({ streetAddress: '5242 Cherryhill Cres', cityOrLocation: 'Burlington, ON L7L4C4', contactTitle: 'Owner', employees: '4' })}`,
      `a2,Ackerman Painting ${tag},Pat Ackerman ${tag},${phone(1)},,ackerman-${tag}.example,Painters,NEW,${META({ cityOrLocation: 'Burlington, ON L7L4C4', contactTitle: 'Estimator' })}`,
      `b1,Acme Plumbing ${tag},,${phone(2)},,,Plumbers,NEW,${META({ streetAddress: '123 Main St', cityOrLocation: 'Toronto, ON M5V2H1' })}`,
    ].join('\n');
    const first = await stage(csv, { fileName: `leads-${tag}.csv` });
    expect(first.inspection.summary).toMatchObject({ businesses: { total: 2 }, people: { total: 2 }, affiliations: 2 });
    expect(first.rows).toHaveLength(4);
    expect(first.rows.map(row => [rowTranslation(row)?.entity, row.status, row.proposedAction])).toEqual([
      ['business', 'ready', 'create'], ['business', 'ready', 'create'], ['person', 'ready', 'create'], ['person', 'ready', 'create'],
    ]);
    const company = first.row(`Ackerman Painting ${tag}`);
    expect(rowTranslation(company)?.sourceRefs).toEqual(['a1', 'a2']);
    expect(rowTranslation(first.row(`Chris Ackerman ${tag}`))?.business).toEqual({ name: `Ackerman Painting ${tag}`, sourceKey: company.sourceRecordKey });
    // The shared business telephone is on the business, so the second person is not held for it.
    expect(first.row(`Pat Ackerman ${tag}`)).toMatchObject({ status: 'ready', matchReason: null });

    await applyImportRun(owner.db, { organizationId, runId: first.runId });
    expect(await getImportRun(owner.db, { organizationId, runId: first.runId })).toMatchObject({ status: 'completed', rowsCreated: 4, rowsFailed: 0 });
    const [ackerman] = await contactsNamed(`Ackerman Painting ${tag}`);
    expect(ackerman).toMatchObject({ contact_type: 'company', phone: phone(1), custom: expect.objectContaining({ industry: 'Painters', website: `https://ackerman-${tag}.example`, estimated_employees: 4, postal_code: 'L7L 4C4' }) });
    const [chris] = await contactsNamed(`Chris Ackerman ${tag}`);
    expect(chris).toMatchObject({ contact_type: 'person', phone: null, email: `chris.${tag}@ackerman.test` });
    expect(await affiliationsOf(chris.id)).toEqual([{ company_id: ackerman.id, title: 'Owner', active: true }]);
    const [pat] = await contactsNamed(`Pat Ackerman ${tag}`);
    expect(await affiliationsOf(pat.id)).toEqual([{ company_id: ackerman.id, title: 'Estimator', active: true }]);
    expect(await contactsNamed(`Acme Plumbing ${tag}`)).toHaveLength(1);
    const places = await owner.db.from('customer_locations').select('location:locations(address)').eq('organization_id', organizationId).eq('customer_id', ackerman.id);
    expect(places.data?.map(link => (link.location as unknown as { address: string }).address)).toEqual(['5242 Cherryhill Cres, Burlington, ON']);

    // The same file again: every row is its own contact already, and nobody is created twice.
    const again = await stage(csv, { fileName: `leads-${tag}.csv` });
    expect(again.rows.map(row => [row.proposedAction, row.matchReason])).toEqual([['update', 'source'], ['update', 'source'], ['update', 'source'], ['update', 'source']]);
    await applyImportRun(owner.db, { organizationId, runId: again.runId });
    expect(await getImportRun(owner.db, { organizationId, runId: again.runId })).toMatchObject({ rowsCreated: 0, rowsUpdated: 4, rowsFailed: 0 });
    for (const name of [`Ackerman Painting ${tag}`, `Chris Ackerman ${tag}`, `Pat Ackerman ${tag}`, `Acme Plumbing ${tag}`]) expect(await contactsNamed(name)).toHaveLength(1);
    expect(await affiliationsOf(chris.id)).toHaveLength(1);
  });

  it('holds what must be confirmed until a person decides, and a skipped business links nobody', async () => {
    const csv = [HEADERS,
      `k1,Kristy Cameron ${tag},,${phone(3)},,,General Contractors,NEW,${META({ cityOrLocation: 'Courtenay, BC V9N3S1' })}`,
      `w1,Willow Services ${tag},Taylor Example ${tag},${phone(4)},,,Services,BAD_DATA,${META({ streetAddress: 'PO Box 10', cityOrLocation: 'Ottawa, ON K1A 0A1' })}`,
      `d1,Dispatch Coffee ${tag},267 Rue Saint-Zotique O,${phone(5)},,,,NEW,${META({ contactTitle: 'Montreal, QC H2V1A4' })}`,
    ].join('\n');
    const run = await stage(csv);
    const kristy = run.row(`Kristy Cameron ${tag}`);
    expect(kristy).toMatchObject({ status: 'review', proposedAction: 'review', matchReason: 'quality', candidateIds: [] });
    expect(rowTranslation(kristy)?.issues.map(issue => issue.code)).toEqual(['business_name_looks_personal']);
    const willow = run.row(`Willow Services ${tag}`);
    expect(willow).toMatchObject({ status: 'review', matchReason: 'quality' });
    expect(run.row(`Taylor Example ${tag}`)).toMatchObject({ status: 'review', matchReason: 'quality' });
    // The address in the name column made no person; the business is ready on its own.
    const dispatch = run.row(`Dispatch Coffee ${tag}`);
    expect(dispatch).toMatchObject({ status: 'ready', proposedAction: 'create' });
    expect(run.rows.filter(row => rowTranslation(row)?.entity === 'person').map(row => (row.normalized as { name: string }).name)).toEqual([`Taylor Example ${tag}`]);
    await expect(applyImportRun(owner.db, { organizationId, runId: run.runId })).rejects.toThrow('Decide every row marked Needs review before importing.');

    await decideImportRow(owner.db, { organizationId, runId: run.runId, rowId: kristy.id, decision: 'create' });
    await decideImportRow(owner.db, { organizationId, runId: run.runId, rowId: willow.id, decision: 'skip' });
    await decideImportRow(owner.db, { organizationId, runId: run.runId, rowId: run.row(`Taylor Example ${tag}`).id, decision: 'create' });
    await applyImportRun(owner.db, { organizationId, runId: run.runId });
    expect(await getImportRun(owner.db, { organizationId, runId: run.runId })).toMatchObject({ status: 'completed', rowsCreated: 3, rowsSkipped: 1 });
    expect(await contactsNamed(`Willow Services ${tag}`)).toHaveLength(0);
    const [taylor] = await contactsNamed(`Taylor Example ${tag}`);
    expect(await affiliationsOf(taylor.id)).toEqual([]);
    const skipped = await owner.db.from('events').select('payload').eq('organization_id', organizationId).eq('entity_id', taylor.id).eq('action', 'contact.import_affiliation_skipped');
    expect(skipped.data).toHaveLength(1);
    expect(await contactsNamed(`Kristy Cameron ${tag}`)).toHaveLength(1);
  });

  it('keeps a historical do-not-call value as a restriction on the business, never as consent, and links a person to a business matched by phone', async () => {
    const existing = await owner.db.rpc('create_crm_contact', { p_organization_id: organizationId, p_name: `Cedar Workshop ${tag}`, p_email: null as unknown as string, p_phone: phone(6), p_custom: {}, p_contact_type: 'company' });
    expect(existing.error).toBeNull();
    const csv = [HEADERS, `c1,Cedar Workshop ${tag},Jamie Example ${tag},${phone(6)},,,Fabrication,DNC,${META({ contactTitle: 'Owner' })}`].join('\n');
    const run = await stage(csv);
    const cedar = run.row(`Cedar Workshop ${tag}`);
    expect(cedar).toMatchObject({ status: 'review', matchReason: 'phone', candidateIds: [existing.data] });
    expect(rowTranslation(cedar)?.restrictions).toEqual({ doNotCall: true, legacyStatus: 'DNC' });
    await decideImportRow(owner.db, { organizationId, runId: run.runId, rowId: cedar.id, decision: 'update', customerId: existing.data });
    await applyImportRun(owner.db, { organizationId, runId: run.runId });
    expect(await getImportRun(owner.db, { organizationId, runId: run.runId })).toMatchObject({ rowsCreated: 1, rowsUpdated: 1, rowsFailed: 0 });
    const [company] = await contactsNamed(`Cedar Workshop ${tag}`);
    expect(company.custom).toMatchObject({ do_not_call: true, lead_status: 'DNC' });
    const [jamie] = await contactsNamed(`Jamie Example ${tag}`);
    expect(await affiliationsOf(jamie.id)).toEqual([{ company_id: existing.data, title: 'Owner', active: true }]);
  });

  it('refuses a translated import without integration.manage and never reads another business’s source', async () => {
    const csv = [HEADERS, `x1,Outside ${tag},Someone ${tag},${phone(7)},,,,NEW,`].join('\n');
    await expect(stage(csv, { db: viewer.db })).rejects.toThrow();
    const { resourceId } = await uploadImportFile(owner.db, { files: supabaseFileStore(owner.db, BUCKET), organizationId, file: new File([csv], `mine-${tag}.csv`, { type: 'text/csv' }) });
    await expect(inspectImportSource(outsider.db, { organizationId, resourceId })).rejects.toThrow();
    await expect(inspectImportSource(outsider.db, { organizationId: otherOrg, resourceId })).rejects.toThrow();
    expect((await outsider.db.from('import_staging_rows').select('id').eq('organization_id', organizationId)).data).toEqual([]);
    expect(await contactsNamed(`Outside ${tag}`)).toHaveLength(0);
  });
});
