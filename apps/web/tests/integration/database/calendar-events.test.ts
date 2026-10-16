import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { listCalendarEvents, saveCalendarEvent, cancelCalendarEvent } from '@/lib/domain/calendar/events';
import type { Database } from '@/lib/db/types';
const url = process.env.SUPABASE_URL!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
async function account() {
  const email = `calendar-${randomUUID()}@example.test`, password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  const db = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { db, email, id: user.data.user.id };
}
describe('native workspace calendar events under real RLS', () => {
  let owner: Awaited<ReturnType<typeof account>>, member: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>;
  let organizationId: string;
  const within = { startsAt: '2027-01-01T00:00:00Z', endsAt: '2027-02-01T00:00:00Z' };
  beforeAll(async () => {
    [owner, member, outsider] = await Promise.all([account(),account(),account()]);
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Calendar test', currency: 'CAD' });
    const roleId = await createRole(owner.db, { organizationId, name: 'Member', capabilities: [] });
    await addMember(owner.db, { organizationId, email: member.email, roleId });
  });
  const fields = () => ({ organizationId, workspace: 'crm' as const, title: 'Planning meeting', startsAt: '2027-01-04T09:00:00Z', endsAt: '2027-01-04T10:00:00Z' });
  it('creates, reads, edits and cancels events without Customers, Follow-ups or their feature', async () => {
    const id = await saveCalendarEvent(member.db, fields());
    await saveCalendarEvent(member.db, { ...fields(), id, startsAt: '2027-01-05T09:00:00Z', endsAt: '2027-01-05T11:00:00Z' });
    expect((await listCalendarEvents(owner.db, { organizationId, within, workspace: 'crm' })).find(event => event.id === id)?.startsAt).toContain('2027-01-05');
    expect(await listCalendarEvents(owner.db, { organizationId, within, workspace: 'field' })).toEqual([]);
    await cancelCalendarEvent(member.db, { organizationId, id });
    expect((await listCalendarEvents(owner.db, { organizationId, within })).some(event => event.id === id)).toBe(false);
  });
  it('refuses cross-tenant reads and writes, another member edits, forged attribution and invalid windows', async () => {
    const id = await saveCalendarEvent(owner.db, fields());
    expect(await listCalendarEvents(outsider.db, { organizationId, within })).toEqual([]);
    await expect(saveCalendarEvent(outsider.db, fields())).rejects.toBeInstanceOf(Error);
    await expect(saveCalendarEvent(member.db, { ...fields(), id, title: 'Hijacked' })).rejects.toBeInstanceOf(Error);
    await expect(cancelCalendarEvent(member.db, { organizationId, id })).rejects.toBeInstanceOf(Error);
    expect((await member.db.from('calendar_events').update({ created_by: member.id }).eq('id', id)).error).not.toBeNull();
    expect((await member.db.from('calendar_events').insert({ organization_id: organizationId, workspace: 'crm', title: 'Forged', starts_at: fields().startsAt, ends_at: fields().endsAt, created_by: owner.id })).error).not.toBeNull();
    await expect(saveCalendarEvent(owner.db, { ...fields(), endsAt: fields().startsAt })).rejects.toBeInstanceOf(Error);
    expect((await owner.db.from('calendar_events').update({ ends_at: fields().startsAt }).eq('id', id)).error).not.toBeNull();
    const anon = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
    expect((await anon.from('calendar_events').select('*')).data ?? []).toEqual([]);
  });
  it('allows an administrator to correct a teammate event while preserving its attribution', async () => {
    const id = await saveCalendarEvent(member.db, fields());
    await saveCalendarEvent(owner.db, { ...fields(), id, title: 'Corrected' });
    expect((await listCalendarEvents(owner.db, { organizationId, within })).find(event => event.id === id)).toMatchObject({ title: 'Corrected', createdBy: member.id });
  });
});
