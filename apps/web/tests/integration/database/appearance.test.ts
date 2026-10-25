import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getAppearance, saveAppearance, resetAppearance } from '@/lib/domain/identity/appearance';
import type { Db } from '@/lib/db/types';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const client = () => createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = client(), other = client(), guest = client();
const password = `appearance-${randomUUID()}`;
const email = `appearance-${randomUUID()}@example.test`;
const ids: string[] = [];
let admin: ReturnType<typeof createClient>;
beforeAll(async () => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Appearance fixtures are local-only.');
  admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  for (const [db, address] of [[owner, email], [other, `other-${email}`]] as const) {
    const result = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
    if (result.error) throw result.error; ids.push(result.data.user.id);
    const signed = await db.auth.signInWithPassword({ email: address, password }); if (signed.error) throw signed.error;
  }
});
afterAll(async () => { for (const id of ids) await admin.auth.admin.deleteUser(id); });

it('has no automatic row; persists across sessions and resets by deleting overrides', async () => {
  expect(await getAppearance(owner as Db)).toEqual({});
  expect((await owner.from('account_appearance_preferences').select()).data).toEqual([]);
  await saveAppearance(owner as Db, { appearance: 'dark', preset: 'expressive', density: 'compact', shape: 'soft', motion: 'reduced' });
  const fresh = client(); await fresh.auth.signInWithPassword({ email, password });
  expect(await getAppearance(fresh as Db)).toEqual({ appearance: 'dark', preset: 'expressive', density: 'compact', shape: 'soft', motion: 'reduced' });
  await resetAppearance(owner as Db);
  expect((await fresh.from('account_appearance_preferences').select()).data).toEqual([]);
});
it('stores the background treatment as a personal preference and refuses an unknown one', async () => {
  expect(await saveAppearance(owner as Db, { background: 'ambient3d' })).toMatchObject({ background: 'ambient3d' });
  expect(await getAppearance(owner as Db)).toMatchObject({ background: 'ambient3d' });
  expect((await other.from('account_appearance_preferences').select('background').eq('user_id', ids[0])).data).toEqual([]);
  expect((await owner.from('account_appearance_preferences').update({ background: 'video' }).eq('user_id', ids[0])).error).not.toBeNull();
  await expect(saveAppearance(owner as Db, { background: 'video' })).rejects.toMatchObject({ code: 'identity.appearance_invalid' });
  await saveAppearance(owner as Db, { preset: 'minimal' });
  expect(await getAppearance(owner as Db)).toEqual({ appearance: 'system', preset: 'minimal' });
  await resetAppearance(owner as Db);
});
it('enforces own-account read/insert/update/delete and immutable owner under real RLS', async () => {
  await saveAppearance(owner as Db, { appearance: 'light' });
  expect((await other.from('account_appearance_preferences').select().eq('user_id', ids[0])).data).toEqual([]);
  expect((await other.from('account_appearance_preferences').insert({ user_id: ids[0], appearance: 'dark' })).error).not.toBeNull();
  expect((await other.from('account_appearance_preferences').update({ appearance: 'dark' }).eq('user_id', ids[0]).select()).data).toEqual([]);
  expect((await other.from('account_appearance_preferences').delete().eq('user_id', ids[0]).select()).data).toEqual([]);
  expect((await owner.from('account_appearance_preferences').update({ user_id: ids[1] }).eq('user_id', ids[0])).error).not.toBeNull();
  expect((await owner.from('account_appearance_preferences').update({ preset: 'invented' }).eq('user_id', ids[0])).error).not.toBeNull();
  expect(await getAppearance(owner as Db)).toMatchObject({ appearance: 'light' });
});
it('denies unauthenticated and signed-anonymous accounts, including direct table writes', async () => {
  expect((await guest.from('account_appearance_preferences').select()).error).not.toBeNull();
  await expect(saveAppearance(guest as Db, {})).rejects.toMatchObject({ code: 'auth.required' });
  const anonymous = await guest.auth.signInAnonymously(); if (anonymous.error) throw anonymous.error;
  ids.push(anonymous.data.user!.id);
  expect((await guest.from('account_appearance_preferences').insert({ user_id: anonymous.data.user!.id })).error).not.toBeNull();
  await expect(getAppearance(guest as Db)).rejects.toMatchObject({ code: 'auth.required' });
});
