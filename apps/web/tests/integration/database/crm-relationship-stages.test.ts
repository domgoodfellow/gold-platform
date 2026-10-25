import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createContact, getContact, updateContact } from '@/lib/domain/contacts/contacts';
import { createCustomerStage, customerStageUsage, deleteCustomerStage, listCustomerStages, moveCustomerStage } from '@/lib/domain/customers/stages';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `stages-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db };
}

describe('relationship stage configuration under real PostgreSQL RLS', () => {
  let owner: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>, member: Awaited<ReturnType<typeof account>>;
  let organizationId: string, first: string, second: string, third: string, contact: string;
  beforeAll(async () => {
    [owner, outsider, member] = await Promise.all([account(), account(), account()]);
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Stage config', currency: 'CAD', timezone: 'UTC' });
    await foundBusiness({ ownerEmail: outsider.email, name: 'Other stages', currency: 'CAD' });
    // Legacy-style equal positions: the list order is the tie-break, and moving settles it.
    first = await createCustomerStage(owner.db, { organizationId, name: 'Introduced', position: 0 });
    second = await createCustomerStage(owner.db, { organizationId, name: 'Engaged', position: 0 });
    third = await createCustomerStage(owner.db, { organizationId, name: 'Partner', position: 1 });
    contact = await createContact(owner.db, { organizationId, name: 'Staged Person', contactType: 'person' });
    const roleId = await createRole(owner.db, { organizationId, name: 'Stage reader', capabilities: ['customer.update'] });
    await addMember(owner.db, { organizationId, email: member.email, roleId });
  });

  it('reorders through the existing position column, one persisted step at a time', async () => {
    const before = (await listCustomerStages(owner.db, { organizationId })).map(stage => stage.id);
    await moveCustomerStage(owner.db, { organizationId, id: before[2], direction: 'up' });
    const after = await listCustomerStages(owner.db, { organizationId });
    expect(after.map(stage => stage.id)).toEqual([before[0], before[2], before[1]]);
    expect(after.map(stage => stage.position)).toEqual([0, 1, 2]);
    await moveCustomerStage(owner.db, { organizationId, id: before[0], direction: 'up' });
    expect((await listCustomerStages(owner.db, { organizationId })).map(stage => stage.id)).toEqual([before[0], before[2], before[1]]);
    expect(new Set([first, second, third])).toEqual(new Set(before));
  });

  it('refuses to remove a stage a contact is on, and keeps that contact on it', async () => {
    await updateContact(owner.db, { organizationId, customerId: contact, name: 'Staged Person', contactType: 'person', stageId: second });
    expect((await customerStageUsage(owner.db, organizationId)).get(second)).toBe(1);
    await expect(deleteCustomerStage(owner.db, { organizationId, id: second })).rejects.toMatchObject({ code: 'customer_stages.in_use' });
    expect((await getContact(owner.db, { organizationId, customerId: contact }))?.stageId).toBe(second);
    await updateContact(owner.db, { organizationId, customerId: contact, name: 'Staged Person', contactType: 'person', stageId: first });
    await deleteCustomerStage(owner.db, { organizationId, id: second });
    expect((await listCustomerStages(owner.db, { organizationId })).map(stage => stage.id)).not.toContain(second);
    expect((await getContact(owner.db, { organizationId, customerId: contact }))?.stageId).toBe(first);
  });

  it('refuses removal and reordering to members without field.manage and to other businesses', async () => {
    await expect(deleteCustomerStage(member.db, { organizationId, id: third })).rejects.toMatchObject({ code: 'customer_stages.delete_refused' });
    await expect(deleteCustomerStage(outsider.db, { organizationId, id: third })).rejects.toMatchObject({ code: 'customer_stages.delete_refused' });
    await expect(moveCustomerStage(member.db, { organizationId, id: third, direction: 'up' })).rejects.toBeInstanceOf(Error);
    expect((await listCustomerStages(owner.db, { organizationId })).map(stage => stage.id)).toContain(third);
    expect(await customerStageUsage(outsider.db, organizationId)).toEqual(new Map());
  });
});
