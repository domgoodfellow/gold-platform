import { describe, expect, it } from 'vitest';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import type { Db } from '@/lib/db/types';

/**
 * A failed read is not an authorization decision. The Platform section once vanished because a
 * database behind the migration that added `platform_staff.capabilities` answered with an error,
 * and the read turned that into "no permissions". These pin the three answers apart: no row is a
 * valid empty set, a row is its capabilities, and an error is an error.
 */

function fakeDb(result: { data: unknown; error: { message: string } | null }, signedIn = true): Db {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
    then: (resolve: (value: unknown) => unknown) => resolve(result),
  };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null } }) },
    from: () => query,
  } as unknown as Db;
}

describe('platformPermissions', () => {
  it('no platform_staff row is a valid empty set', async () => {
    expect((await platformPermissions(fakeDb({ data: null, error: null }))).size).toBe(0);
  });

  it('a row is its capabilities, ignoring any it does not know', async () => {
    const db = fakeDb({ data: { capabilities: ['platform.providers', 'platform.unheard-of'] }, error: null });
    expect([...(await platformPermissions(db))]).toEqual(['platform.providers']);
  });

  it('a signed-out caller has none', async () => {
    expect((await platformPermissions(fakeDb({ data: null, error: null }, false))).size).toBe(0);
  });

  it('a failed read — a schema behind the migration — is an error, never an empty set', async () => {
    const db = fakeDb({ data: null, error: { message: 'column platform_staff.capabilities does not exist' } });
    await expect(platformPermissions(db)).rejects.toMatchObject({ code: 'platform.permissions_unreadable' });
  });
});

describe('isPlatformStaff', () => {
  it('a failed read is an error, never "not staff"', async () => {
    const db = fakeDb({ data: null, error: { message: 'boom' } });
    await expect(isPlatformStaff(db)).rejects.toMatchObject({ code: 'platform.staff_unreadable' });
  });
});
