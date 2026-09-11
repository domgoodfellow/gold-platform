import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, getCustomer } from '@/lib/domain/customers/customers';
import { createFieldDefinition, listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import {
  disconnectConnection,
  listConnections,
  recordConnection,
} from '@/lib/domain/integrations/connections';
import { listResources, uploadCsvResource } from '@/lib/domain/integrations/resources';
import { createMapping, suggestMapping, type MappingField } from '@/lib/domain/integrations/mappings';
import {
  applyImportRun,
  beginImportRun,
  getImportRun,
  listStagingRows,
  stageRows,
} from '@/lib/domain/integrations/import-runs';
import { parseCsv } from '@/lib/domain/integrations/csv';
import { foundBusiness } from './helpers/founding';

/**
 * The vertical slice: CSV → mapping → staging → review → apply, proven against real Postgres.
 *
 * Google Sheets and every other connector reuse this exact engine (connections, resources,
 * mappings, runs, staging, external_record_links) unchanged — CSV differs only in how bytes
 * become rows, which is `lib/domain/integrations/csv.ts` alone.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string): Promise<Tenant> {
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

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

function csvFile(text: string, name = 'leads.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

/** Mirrors what a browser upload gives `stageRows`: one key, one raw row, per parsed line. */
function keyedRows(rows: Record<string, string>[]): { key: string; raw: Record<string, string> }[] {
  return rows.map((raw, index) => ({ key: `row-${index}`, raw }));
}

describe('integrations: CSV import', () => {
  let aliceEmailFieldRows: string;
  let aliceMapping: MappingField[];
  let aliceExistingCustomerId: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('alice');
    bob = await newTenant('bob');

    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'industry',
      label: 'Industry',
      kind: 'select',
      required: false,
      options: ['Plumbing', 'Electrical'],
    });
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'website',
      label: 'Website',
      kind: 'text',
      required: false,
    });

    // A customer this business already has, so one CSV row can prove the "update, not
    // duplicate" path rather than only the "create" one.
    aliceExistingCustomerId = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Carol Old Name',
      email: 'carol@example.test',
    });

    aliceEmailFieldRows = [
      'name,email,phone,website,industry',
      'Ann Baker,ann@example.test,+1 (604) 555-1234,https://annbakery.test,Plumbing',
      'Carol New Name,carol@example.test,,https://carol.test,Electrical',
      'Dupe Row,ann@example.test,+1 (604) 555-1234,https://annbakery.test,Plumbing',
      'Bad Website,eve@example.test,,not a url at all,Plumbing',
      'Bad Industry,frank@example.test,,https://frank.test,Underwater Basket Weaving',
    ].join('\n');
  });

  it('connects, uploads a CSV, and detects headers', async () => {
    const connectionId = await recordConnection(alice.db, {
      organizationId: alice.organizationId,
      connectorKey: 'csv',
      accountLabel: 'Uploaded files',
    });

    const connections = await listConnections(alice.db, { organizationId: alice.organizationId });
    expect(connections.map((c) => c.id)).toContain(connectionId);
    expect(connections.find((c) => c.id === connectionId)?.status).toBe('connecting');

    const { resourceId, parsed } = await uploadCsvResource(alice.db, {
      organizationId: alice.organizationId,
      connectionId,
      file: csvFile(aliceEmailFieldRows),
    });

    expect(parsed.headers).toEqual(['name', 'email', 'phone', 'website', 'industry']);
    expect(parsed.totalRows).toBe(5);

    const resources = await listResources(alice.db, { organizationId: alice.organizationId, connectionId });
    expect(resources.map((r) => r.id)).toContain(resourceId);

    // Bob cannot see Alice's connection or resource at all (I1).
    const bobConnections = await listConnections(bob.db, { organizationId: alice.organizationId });
    expect(bobConnections).toEqual([]);
  });

  it('suggests a mapping deterministically, without a model', async () => {
    const definitions = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });
    const parsed = parseCsv(aliceEmailFieldRows);
    aliceMapping = suggestMapping(parsed.headers, definitions);

    const byColumn = new Map(aliceMapping.map((field) => [field.sourceColumn, field]));
    expect(byColumn.get('name')?.target).toEqual({ kind: 'core', field: 'name' });
    expect(byColumn.get('email')?.target).toEqual({ kind: 'core', field: 'email' });
    expect(byColumn.get('phone')?.target).toEqual({ kind: 'core', field: 'phone' });
    expect(byColumn.get('industry')?.target).toEqual({ kind: 'custom', key: 'industry' });
    // Matched by name against this tenant's own field registry — the suggestion engine doesn't
    // guess a semantic transform beyond the three core columns, so a person still chooses "url"
    // for this one below, the same way they'd pick it in the mapping table on screen.
    expect(byColumn.get('website')?.target).toEqual({ kind: 'custom', key: 'website' });

    const website = aliceMapping.find((field) => field.sourceColumn === 'website');
    if (website) website.transform = 'url';
  });

  it('stages rows: matches an existing customer, flags a duplicate, and rejects bad values', async () => {
    const definitions = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    const resources = await listResources(alice.db, { organizationId: alice.organizationId });
    const resourceId = resources[0].id;

    const mappingId = await createMapping(alice.db, {
      organizationId: alice.organizationId,
      resourceId,
      fields: aliceMapping,
      dedupeKey: 'email',
    });

    const runId = await beginImportRun(alice.db, { organizationId: alice.organizationId, mappingId });

    const parsed = parseCsv(aliceEmailFieldRows);
    const staged = await stageRows(alice.db, {
      organizationId: alice.organizationId,
      runId,
      mapping: aliceMapping,
      fieldDefinitions: definitions,
      sourceRows: keyedRows(parsed.rows),
    });
    expect(staged).toBe(5);

    const rows = await listStagingRows(alice.db, { organizationId: alice.organizationId, runId });
    const byKey = new Map(rows.map((row) => [row.sourceRecordKey, row]));

    expect(byKey.get('row-0')?.status).toBe('ready');
    expect(byKey.get('row-0')?.proposedAction).toBe('create');

    expect(byKey.get('row-1')?.status).toBe('ready');
    expect(byKey.get('row-1')?.proposedAction).toBe('update');
    expect(byKey.get('row-1')?.matchedCustomerId).toBe(aliceExistingCustomerId);

    expect(byKey.get('row-2')?.status).toBe('duplicate');
    expect(byKey.get('row-2')?.proposedAction).toBe('skip');

    expect(byKey.get('row-3')?.status).toBe('invalid');
    expect(byKey.get('row-3')?.validationErrors.length).toBeGreaterThan(0);

    expect(byKey.get('row-4')?.status).toBe('invalid');
    expect(byKey.get('row-4')?.validationErrors.some((m) => m.includes('Industry'))).toBe(true);

    // Stash the run id on the module scope for the apply test below via a closure would need
    // restructuring; simplest is to re-derive it from the run list.
    (globalThis as { __ALICE_RUN_ID__?: string }).__ALICE_RUN_ID__ = runId;
  });

  it('applies a run: creates, updates, skips, never touches invalid or duplicate rows', async () => {
    const runId = (globalThis as { __ALICE_RUN_ID__?: string }).__ALICE_RUN_ID__!;

    await applyImportRun(alice.db, { organizationId: alice.organizationId, runId });

    const run = await getImportRun(alice.db, { organizationId: alice.organizationId, runId });
    expect(run?.status).toBe('completed');
    expect(run?.rowsCreated).toBe(1);
    expect(run?.rowsUpdated).toBe(1);
    expect(run?.rowsSkipped).toBe(3);
    expect(run?.rowsFailed).toBe(0);

    const carol = await getCustomer(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceExistingCustomerId,
    });
    expect(carol?.name).toBe('Carol New Name');
    expect(carol?.custom.industry).toBe('Electrical');

    const { data: annRows } = await alice.db
      .from('customers')
      .select('id, name, custom')
      .eq('organization_id', alice.organizationId)
      .eq('email', 'ann@example.test');
    expect(annRows).toHaveLength(1);
    expect(annRows![0].name).toBe('Ann Baker');

    // Applying the same run twice is refused rather than replaying it.
    await expect(
      applyImportRun(alice.db, { organizationId: alice.organizationId, runId }),
    ).rejects.toMatchObject({ code: 'integrations.already_applied' });
  });

  it('is idempotent: re-importing the same file never duplicates a customer', async () => {
    const definitions = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });
    const resources = await listResources(alice.db, { organizationId: alice.organizationId });
    const resourceId = resources[0].id;

    const mappingId = await createMapping(alice.db, {
      organizationId: alice.organizationId,
      resourceId,
      fields: aliceMapping,
      dedupeKey: 'email',
    });

    const secondRunId = await beginImportRun(alice.db, {
      organizationId: alice.organizationId,
      mappingId,
    });

    const parsed = parseCsv(aliceEmailFieldRows);
    await stageRows(alice.db, {
      organizationId: alice.organizationId,
      runId: secondRunId,
      mapping: aliceMapping,
      fieldDefinitions: definitions,
      sourceRows: keyedRows(parsed.rows),
    });
    await applyImportRun(alice.db, { organizationId: alice.organizationId, runId: secondRunId });

    const { data: annRows } = await alice.db
      .from('customers')
      .select('id')
      .eq('organization_id', alice.organizationId)
      .eq('email', 'ann@example.test');
    // Still exactly one Ann Baker after two imports of the same file.
    expect(annRows).toHaveLength(1);

    const { data: links } = await alice.db
      .from('external_record_links')
      .select('gold_entity_id')
      .eq('organization_id', alice.organizationId)
      .eq('external_record_id', 'row-0');
    expect(links).toHaveLength(1);
    expect(links![0].gold_entity_id).toBe(annRows![0].id);
  });

  it('refuses a member without integration.manage (I12)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Integrations',
      capabilities: ['role.manage', 'customer.create'],
    });
    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();
    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      recordConnection(bob.db, { organizationId: bob.organizationId, connectorKey: 'csv' }),
    ).rejects.toMatchObject({ code: 'integrations.forbidden' });
  });

  it('disconnecting a connection never touches the customers it already imported (I1/I8)', async () => {
    const connections = await listConnections(alice.db, { organizationId: alice.organizationId });
    const connection = connections[0];

    await disconnectConnection(alice.db, {
      organizationId: alice.organizationId,
      connectionId: connection.id,
    });

    const after = await listConnections(alice.db, { organizationId: alice.organizationId });
    expect(after.find((c) => c.id === connection.id)?.status).toBe('disconnected');

    const carol = await getCustomer(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceExistingCustomerId,
    });
    expect(carol).not.toBeNull();
    expect(carol?.name).toBe('Carol New Name');
  });
});
