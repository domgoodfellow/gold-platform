import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { getAppearance, saveAppearance, resetAppearance, validateAppearance } from '@/lib/domain/identity/appearance';

function database(result: { data?: unknown; error?: unknown } = {}, anonymous = false) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => result), upsert: vi.fn(), single: vi.fn(async () => result), delete: vi.fn() };
  for (const key of ['select', 'upsert', 'delete'] as const) chain[key].mockReturnValue(chain);
  chain.eq.mockReturnValue({ ...chain, then: (resolve: (value: unknown) => unknown) => resolve(result) });
  return { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'account-a', is_anonymous: anonymous } }, error: null })) }, from: vi.fn(() => chain), chain };
}

describe('account appearance domain', () => {
  it('accepts only closed personal choices; absence remains default', () => {
    expect(validateAppearance({})).toEqual({});
    expect(validateAppearance({ appearance: 'dark', preset: 'layered', shape: null })).toEqual({ appearance: 'dark', preset: 'layered' });
    for (const input of [null, [], { preset: 'default' }, { density: 'huge' }, { shape: 'circle' }, { motion: 'full' }, { user_id: 'other' }, { css: 'color:red' }]) expect(() => validateAppearance(input)).toThrow();
  });
  it('returns defaults only for a successfully read missing row', async () => {
    const db = database({ data: null, error: null });
    expect(await getAppearance(db as unknown as Db)).toEqual({});
    expect(db.chain.eq).toHaveBeenCalledWith('user_id', 'account-a');
    await expect(getAppearance(database({ error: { message: 'offline' } }) as unknown as Db)).rejects.toMatchObject({ code: 'identity.appearance_read_failed' });
  });
  it('derives the writer from the verified session and preserves nullable defaults', async () => {
    const db = database({ data: { user_id: 'account-a' }, error: null });
    expect(await saveAppearance(db as unknown as Db, { preset: 'minimal' })).toEqual({ appearance: 'system', preset: 'minimal' });
    expect(db.chain.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'account-a', appearance: 'system', preset: 'minimal', density: null, shape: null, motion: null }));
  });
  it('surfaces refused writes and resets', async () => {
    const db = database({ error: { message: 'refused' } }) as unknown as Db;
    await expect(saveAppearance(db, {})).rejects.toMatchObject({ code: 'identity.appearance_write_failed' });
    await expect(resetAppearance(db)).rejects.toMatchObject({ code: 'identity.appearance_reset_failed' });
  });
  it('refuses anonymous sessions before any table access', async () => {
    const db = database({}, true);
    for (const operation of [() => getAppearance(db as unknown as Db), () => saveAppearance(db as unknown as Db, {}), () => resetAppearance(db as unknown as Db)]) await expect(operation()).rejects.toMatchObject({ code: 'auth.required' });
    expect(db.from).not.toHaveBeenCalled();
  });
});
