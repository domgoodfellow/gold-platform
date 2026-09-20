import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';

/**
 * The one authorization claim of the Configuration Center slice, against real Postgres. Split out of
 * `settings-configuration-center.test.ts`, whose structural claims are a source scan needing no database.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('a capability-limited member gains no configuration authority through the new hub', () => {
  it('is still refused by the database when defining work, exactly as before Slice 3', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const ownerEmail = `owner-${randomUUID().slice(0, 8)}@example.test`;
    const memberEmail = `limited-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;

    for (const email of [ownerEmail, memberEmail]) {
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
    }

    async function signIn(email: string): Promise<SupabaseClient> {
      const db = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return db;
    }

    const owner = await signIn(ownerEmail);
    const organizationId = await createOrganization(owner, {
      name: `Config Center Test ${randomUUID().slice(0, 6)}`,
      displayName: 'Owner',
      timezone: 'UTC',
      currency: 'EUR',
    });

    // A role that can do nothing but exist â€” reused from the exact pattern `roles.test.ts`
    // already relies on for "nothing yet" being a legitimate role.
    const roleId = await createRole(owner, { organizationId, name: 'Onlooker', capabilities: [] });
    await addMember(owner, {
      organizationId,
      email: memberEmail,
      displayName: 'Limited Member',
      roleId,
    });

    const limited = await signIn(memberEmail);

    // The hub is a link, not a grant. Reaching Work configuration is a navigation change; the
    // write underneath it is still `field.manage`, checked by the same RLS as before this
    // slice touched a single line of navigation.
    await expect(
      createWorkItemType(limited, { organizationId, name: 'Should not exist' }),
    ).rejects.toMatchObject({ code: expect.stringContaining('forbidden') });

    const type = await createWorkItemType(owner, { organizationId, name: 'Installation' });
    await expect(
      createWorkItemStatus(limited, { organizationId, typeId: type, name: 'Should not exist' }),
    ).rejects.toMatchObject({ code: expect.stringContaining('forbidden') });
  });
});
