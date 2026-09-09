import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';

/**
 * Settings as the Configuration Center, and Work split into operating it versus defining it
 * (product reality audit, Slice 3).
 *
 * **Structural claims are a source scan**, for the reason `layout.test.ts` and `navigation.test.ts`
 * already give for the same choice: these are facts about which JSX a server component renders,
 * and this repository runs no harness that mounts one. **The one authorization claim is real
 * Postgres**, because a hub that merely links to an existing page cannot itself grant anything —
 * proving that requires actually trying the write as a member who shouldn't be able to.
 */

const ROUTES = fileURLToPath(new URL('../app/organizations/[organizationId]', import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('Settings, as the Configuration Center (source scan)', () => {
  const settings = readFileSync(`${ROUTES}/settings/page.tsx`, 'utf8');

  it('exposes a configuration map rather than only the original six sections', () => {
    expect(settings, 'no ConfigCard hub above the existing sections').toContain('ConfigCard');
  });

  it('reaches Work configuration', () => {
    expect(settings).toContain('/settings/work');
  });

  it('reaches Pricing', () => {
    expect(settings).toMatch(/\/organizations\/\$\{organizationId\}\/pricing/);
  });

  it('reaches Automations', () => {
    expect(settings).toMatch(/\/organizations\/\$\{organizationId\}\/automations/);
  });

  it('reaches Custom fields', () => {
    expect(settings).toMatch(/\/organizations\/\$\{organizationId\}\/fields/);
  });

  it('reaches People & roles', () => {
    expect(settings).toMatch(/\/organizations\/\$\{organizationId\}\/roles/);
  });
});

describe('Settings → Work exists as a real, directly addressable route', () => {
  it('has its own page, distinct from the operational Work screen', () => {
    // Existing merely by not throwing — `readFileSync` fails loudly if the route was never
    // created, which is the actual claim "directly addressable" reduces to for a file-based
    // router: there is a real `page.tsx` at this path, not only a link that points at one.
    const page = readFileSync(`${ROUTES}/settings/work/page.tsx`, 'utf8');
    expect(page).toContain('WorkConfigurationPage');
  });
});

describe('Work, as an operational surface (source scan)', () => {
  const work = readFileSync(`${ROUTES}/work/page.tsx`, 'utf8');

  it('no longer renders the structural configuration forms', () => {
    for (const moved of [
      'CreateTypeForm',
      'CreateStatusForm',
      'EditStatusForm',
      'CreateTransitionForm',
      'RenameTypeForm',
      'AddTypeChecklistItemForm',
      'TypeChecklistItemRow',
      'PublishTypeForm',
    ]) {
      expect(work, `${moved} should have moved to Settings → Work`).not.toContain(moved);
    }
  });

  it('still renders the operational board and its own forms', () => {
    for (const kept of ['CreateWorkItemForm', 'MoveWorkItemForm', 'ScheduleWorkItemForm']) {
      expect(work).toContain(kept);
    }
  });

  it('shows a configuration-link empty state, not a mysteriously empty board, when nothing is configured', () => {
    expect(work).toContain('No kinds of work are configured.');
    expect(work).toMatch(/settings\/work/);
    // The link is offered only to somebody who could act on it — a member who cannot configure
    // work is not shown a control dressed up as one (I12, applied to navigation rather than a
    // write).
    expect(work).toMatch(/mayConfigure\s*\?[\s\S]{0,120}Configure Work in Settings/);
  });
});

describe('Business Setup’s manual links (source scan)', () => {
  it('points its Work step at Settings → Work, not the operational board', () => {
    const setup = readFileSync(`${ROUTES}/setup/page.tsx`, 'utf8');
    expect(setup).toMatch(/segment === 'work'[\s\S]{0,120}'settings'[\s\S]{0,40}\/work/);
  });
});

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

    // A role that can do nothing but exist — reused from the exact pattern `roles.test.ts`
    // already relies on for "nothing yet" being a legitimate role.
    const roleId = await createRole(owner, { organizationId, name: 'Onlooker', capabilities: [] });
    await addMember(owner, {
      organizationId,
      email: memberEmail,
      displayName: 'Limited Member',
      roleId,
    });

    const limited = await signIn(memberEmail);

    // The hub is a link, not a grant. Reaching Settings → Work is a navigation change; the
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
