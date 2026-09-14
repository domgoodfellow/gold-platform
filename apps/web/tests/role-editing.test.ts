import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole, listRoles, updateRoleCapabilities } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';

/**
 * Editing a role, in place — the counterpart to `roles.test.ts`'s "created and reassigned but
 * never edited". Every assertion here has a twin in that file at assignment time; this proves
 * the same invariant holds at edit time, and that the database is what enforces it rather than
 * only `updateRoleCapabilities`.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Actor = { db: SupabaseClient; userId: string; email: string };

async function signUp(label: string): Promise<Actor> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.user.id, email };
}

let owner: Actor;
let organizationId: string;
let adminRoleId: string;

describe('editing a role', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    owner = await signUp('roleedit');
    organizationId = await foundBusiness({
      ownerEmail: owner.email,
      name: `Role Editing ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      currency: 'EUR',
    });

    const roles = await listRoles(owner.db, { organizationId });
    adminRoleId = roles.find((r) => r.name === 'Admin')!.id;
  });

  it('rejects an unknown capability before the RPC is ever called', async () => {
    await expect(
      updateRoleCapabilities(owner.db, {
        roleId: adminRoleId,
        name: 'Admin',
        capabilities: ['customer.delete'],
      }),
    ).rejects.toMatchObject({ code: 'roles.capability_unknown' });
  });

  it('lets a role.manage holder rename a role and change its capabilities, taking effect immediately', async () => {
    const target = await createRole(owner.db, {
      organizationId,
      name: 'Support',
      capabilities: ['customer.create'],
    });

    await updateRoleCapabilities(owner.db, {
      roleId: target,
      name: 'Support Renamed',
      capabilities: ['customer.create', 'customer.update'],
    });

    const roles = await listRoles(owner.db, { organizationId });
    const updated = roles.find((r) => r.id === target)!;
    expect(updated.name).toBe('Support Renamed');
    expect(updated.capabilities.slice().sort()).toEqual(['customer.create', 'customer.update']);
  });

  it('refuses an edit from someone without role.manage (42501)', async () => {
    const managerOnly = await createRole(owner.db, {
      organizationId,
      name: 'Sales Only',
      capabilities: ['customer.create'],
    });

    // A second member on the restricted role, so the owner keeps role.manage throughout —
    // the refusal below is about the second member's own capabilities, not the last-manager
    // invariant tested separately.
    const helper = await signUp('roleedit-helper');
    await addMember(owner.db, {
      organizationId,
      email: helper.email,
      displayName: 'Helper',
      roleId: managerOnly,
    });

    await expect(
      updateRoleCapabilities(helper.db, {
        roleId: managerOnly,
        name: 'Sales Only Renamed',
        capabilities: ['customer.create'],
      }),
    ).rejects.toMatchObject({ code: 'roles.forbidden' });
  });

  it('rejects, atomically, an edit that would leave nobody able to manage roles — enforced by the database itself, not only the domain layer', async () => {
    // Direct RPC, bypassing updateRoleCapabilities' own validation entirely, to prove the
    // refusal is the trigger's and not merely a client-side check.
    const { error } = await owner.db.rpc('update_role', {
      p_role_id: adminRoleId,
      p_name: 'Admin',
      p_capabilities: ['customer.create'],
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');

    // Atomic: the name must not have changed either, since the whole statement rolled back.
    const roles = await listRoles(owner.db, { organizationId });
    const admin = roles.find((r) => r.id === adminRoleId)!;
    expect(admin.name).toBe('Admin');
    expect(admin.capabilities).toContain('role.manage');
  });

  it('still lets a role with no members lose role.manage freely', async () => {
    const spare = await createRole(owner.db, {
      organizationId,
      name: 'Spare',
      capabilities: ['role.manage'],
    });

    await expect(
      updateRoleCapabilities(owner.db, {
        roleId: spare,
        name: 'Spare',
        capabilities: [],
      }),
    ).resolves.toBeUndefined();
  });

  it('records the edit on the timeline', async () => {
    const { data, error } = await owner.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', organizationId)
      .eq('action', 'role.updated');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const event of data!) {
      expect(event.actor_id).toBe(owner.userId);
    }
  });
});
