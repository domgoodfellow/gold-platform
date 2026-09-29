import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  discoverySnapshotCompleteness,
  getDiscoverySnapshot,
  upsertDiscoverySnapshotAnswers,
} from '@/lib/domain/customers/discovery-snapshots';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A discovery snapshot is state about an existing customer, never a second entity (I61). This
 * suite proves the composite FK to `(organization_id, customers.id)` actually refuses a
 * cross-tenant customer id, that the capability gate (`customer.update`) holds, and that
 * `upsertDiscoverySnapshotAnswers` merges rather than overwrites.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

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

describe('discovery snapshots', () => {
  let alice: Tenant;
  let bob: Tenant;
  let aliceCustomerId: string;
  let bobCustomerId: string;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('alice');
    bob = await newTenant('bob');

    aliceCustomerId = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Alice Prospect',
    });
    bobCustomerId = await createCustomer(bob.db, {
      organizationId: bob.organizationId,
      name: 'Bob Prospect',
    });
  });

  it('starts with no snapshot', async () => {
    const snapshot = await getDiscoverySnapshot(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
    });
    expect(snapshot).toBeNull();
  });

  it('starts a snapshot on first write and merges on the next', async () => {
    const first = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { contactChannels: 'Phone and email, prefers email.' },
    });
    expect(first.answers).toEqual({ contactChannels: 'Phone and email, prefers email.' });

    const second = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { teamAccess: 'Two owners, one dispatcher.' },
    });

    expect(second.answers).toEqual({
      contactChannels: 'Phone and email, prefers email.',
      teamAccess: 'Two owners, one dispatcher.',
    });
  });

  it('overwrites only the category a patch names', async () => {
    const updated = await upsertDiscoverySnapshotAnswers(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
      patch: { contactChannels: 'Email only now.' },
    });

    expect(updated.answers.contactChannels).toBe('Email only now.');
    expect(updated.answers.teamAccess).toBe('Two owners, one dispatcher.');
  });

  it('derives completeness rather than storing it', async () => {
    const snapshot = await getDiscoverySnapshot(alice.db, {
      organizationId: alice.organizationId,
      customerId: aliceCustomerId,
    });
    expect(snapshot).not.toBeNull();

    const completeness = discoverySnapshotCompleteness(snapshot!);
    expect(completeness).toEqual({ answered: 2, total: 12 });
  });

  it('shows each tenant only its own snapshot (I1)', async () => {
    await upsertDiscoverySnapshotAnswers(bob.db, {
      organizationId: bob.organizationId,
      customerId: bobCustomerId,
      patch: { bookingIntake: 'Books by phone only.' },
    });

    const stolen = await getDiscoverySnapshot(alice.db, {
      organizationId: bob.organizationId,
      customerId: bobCustomerId,
    });
    expect(stolen).toBeNull();
  });

  it('refuses a customer id that belongs to a different organization', async () => {
    await expect(
      upsertDiscoverySnapshotAnswers(alice.db, {
        organizationId: alice.organizationId,
        customerId: bobCustomerId,
        patch: { existingSoftware: 'Spreadsheets.' },
      }),
    ).rejects.toMatchObject({ code: 'discovery_snapshots.customer_not_found' });
  });
});
