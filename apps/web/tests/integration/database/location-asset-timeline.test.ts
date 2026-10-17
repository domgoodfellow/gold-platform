import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAsset } from '@/lib/domain/assets/assets';
import { recordAssetReading } from '@/lib/domain/assets/readings';
import { createCustomer } from '@/lib/domain/customers/customers';
import { uploadDocument } from '@/lib/domain/documents/documents';
import { createLocation, linkCustomerLocation } from '@/lib/domain/locations/locations';
import { listAssetTimeline, listLocationTimeline } from '@/lib/domain/timeline/timeline';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem, updateWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Location and Asset history — the second and third readers `events` has ever had beyond
 * Customer and Work Item.
 *
 * The interesting assertions here are the negative ones. A location's timeline admits
 * `work_item.updated` (which snapshots `location_id`) and refuses `work_item.created` (which
 * never has, `create_work_item`'s own event never having copied the column) — that asymmetry is
 * the point of the file, not an oversight in it: joining either reader to `work_items`' own
 * *current* `location_id`/`asset_id` would misattribute a job's history to wherever it sits
 * today, which is exactly the falsified-history shape the preserved-history rule refuses. An asset's timeline has no such
 * gap, because `create_work_item` has carried `asset_id` since the column arrived.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  organizationId: string;
  customerId: string;
  typeId: string;
  statusId: string;
};

let acme: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { error: createError } = await admin.auth.admin.createUser({
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

  const orgId = organizationId as string;
  const customerId = await createCustomer(db, { organizationId: orgId, name: `${label} Customer` });
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: orgId, name: 'Service' });
  const statusId = await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' });

  return { db, organizationId: orgId, customerId, typeId, statusId };
}

describe('a location’s history', () => {
  let locationA: string;
  let locationB: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    acme = await newTenant('lat-acme');

    locationA = await createLocation(acme.db, {
      organizationId: acme.organizationId,
      label: 'Depot A',
      address: '1 A Way',
    });
    locationB = await createLocation(acme.db, {
      organizationId: acme.organizationId,
      label: 'Depot B',
      address: '1 B Way',
    });
  });

  it('shows its own creation, and not a sibling location’s', async () => {
    const a = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationA,
    });
    expect(a.map((e) => e.action)).toEqual(['location.created']);
    expect(a[0].description).toBe('Location created');

    const b = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationB,
    });
    expect(b.map((e) => e.action)).toEqual(['location.created']);
  });

  it('names the customer when one is linked here, from the location’s own side', async () => {
    await linkCustomerLocation(acme.db, {
      organizationId: acme.organizationId,
      customerId: acme.customerId,
      locationId: locationA,
    });

    const a = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationA,
    });
    const linked = a.find((e) => e.action === 'location.linked');
    expect(linked?.description).toBe('Customer linked: lat-acme Customer');

    // Not on the sibling location nobody was linked to.
    const b = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationB,
    });
    expect(b.map((e) => e.action)).not.toContain('location.linked');
  });

  it('shows a document attached here, and not one attached elsewhere', async () => {
    await uploadDocument(acme.db, { files: supabaseFileStore(acme.db, BUCKET),
      organizationId: acme.organizationId,
      attachedTo: { entity: 'location', id: locationA },
      file: new File(['x'], 'site-plan.txt', { type: 'text/plain' }),
    });

    const a = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationA,
    });
    expect(a.find((e) => e.action === 'document.created')?.description).toBe(
      'Document attached: site-plan.txt',
    );

    const b = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationB,
    });
    expect(b.map((e) => e.action)).not.toContain('document.created');
  });

  it('admits a job edited to name this location, and not a job merely created here', async () => {
    const jobId = await createWorkItem(acme.db, {
      organizationId: acme.organizationId,
      title: 'Deliver pallets',
      statusId: acme.statusId,
      customerId: acme.customerId,
      locationId: locationA,
    });

    // `work_item.created` never snapshots `location_id` — confirmed absent even though this
    // job was created naming locationA. This is the asymmetry with Asset, not a bug in the test.
    const beforeEdit = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationA,
    });
    expect(beforeEdit.map((e) => e.action)).not.toContain('work_item.created');

    // `work_item.updated` does snapshot it, so an edit is truthfully this location's history
    // from that moment on.
    await updateWorkItem(acme.db, {
      organizationId: acme.organizationId,
      id: jobId,
      title: 'Deliver pallets (confirmed)',
      customerId: acme.customerId,
      locationId: locationA,
    });

    const afterEdit = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationA,
    });
    const updated = afterEdit.find((e) => e.action === 'work_item.updated');
    expect(updated?.description).toBe('Details corrected on Deliver pallets (confirmed)');

    // Never on the location this job was never edited to name.
    const b = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationB,
    });
    expect(b.map((e) => e.action)).not.toContain('work_item.updated');
  });

  it('is newest first', async () => {
    const entries = await listLocationTimeline(acme.db, {
      organizationId: acme.organizationId,
      locationId: locationA,
    });
    const stamps = entries.map((e) => e.occurredAt);
    expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual(stamps);
  });

  it('shows one tenant nothing of another’s location', async () => {
    const other = await newTenant('lat-other-loc');
    const entries = await listLocationTimeline(other.db, {
      organizationId: other.organizationId,
      locationId: locationA,
    });
    expect(entries).toEqual([]);
  });
});

describe('an asset’s history', () => {
  let assetA: string;
  let assetB: string;

  beforeAll(async () => {
    assetA = await createAsset(acme.db, {
      organizationId: acme.organizationId,
      name: 'Compressor A',
      customerId: acme.customerId,
    });
    assetB = await createAsset(acme.db, {
      organizationId: acme.organizationId,
      name: 'Compressor B',
      customerId: acme.customerId,
    });
  });

  it('shows its own creation, and not a sibling asset’s', async () => {
    const a = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetA,
    });
    expect(a.map((e) => e.action)).toEqual(['asset.created']);
    expect(a[0].description).toBe('Asset created');

    const b = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetB,
    });
    expect(b.map((e) => e.action)).toEqual(['asset.created']);
  });

  it('shows a document attached here, and not one attached elsewhere', async () => {
    await uploadDocument(acme.db, { files: supabaseFileStore(acme.db, BUCKET),
      organizationId: acme.organizationId,
      attachedTo: { entity: 'asset', id: assetA },
      file: new File(['x'], 'service-manual.txt', { type: 'text/plain' }),
    });

    const a = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetA,
    });
    expect(a.find((e) => e.action === 'document.created')?.description).toBe(
      'Document attached: service-manual.txt',
    );

    const b = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetB,
    });
    expect(b.map((e) => e.action)).not.toContain('document.created');
  });

  it('admits both a job created about this asset and one later edited to name it', async () => {
    const jobId = await createWorkItem(acme.db, {
      organizationId: acme.organizationId,
      title: 'Annual service',
      statusId: acme.statusId,
      customerId: acme.customerId,
      assetId: assetA,
    });

    const afterCreate = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetA,
    });
    expect(afterCreate.find((e) => e.action === 'work_item.created')?.description).toBe(
      'Work created: Annual service',
    );

    await updateWorkItem(acme.db, {
      organizationId: acme.organizationId,
      id: jobId,
      title: 'Annual service (rescheduled)',
      customerId: acme.customerId,
      assetId: assetA,
    });

    const afterEdit = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetA,
    });
    expect(afterEdit.find((e) => e.action === 'work_item.updated')?.description).toBe(
      'Details corrected on Annual service (rescheduled)',
    );

    // Never on the asset this job was never about.
    const b = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetB,
    });
    expect(b.map((e) => e.action)).not.toContain('work_item.created');
    expect(b.map((e) => e.action)).not.toContain('work_item.updated');
  });

  it('does not show a reading — an append-only counter log with no event of its own', async () => {
    await recordAssetReading(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetA,
      value: 100,
      unit: 'hours',
    });

    const entries = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetA,
    });
    // Nothing new: `recordAssetReading` writes only `asset_readings`, no `events` row.
    expect(entries.map((e) => e.action)).not.toContain('asset.reading_recorded');
  });

  it('is newest first', async () => {
    const entries = await listAssetTimeline(acme.db, {
      organizationId: acme.organizationId,
      assetId: assetA,
    });
    const stamps = entries.map((e) => e.occurredAt);
    expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual(stamps);
  });

  it('shows one tenant nothing of another’s asset', async () => {
    const other = await newTenant('lat-other-asset');
    const entries = await listAssetTimeline(other.db, {
      organizationId: other.organizationId,
      assetId: assetA,
    });
    expect(entries).toEqual([]);
  });
});
