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
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Superseded (2026 Settings migration): the ConfigCard tile grid this block used to assert on
 * `settings/page.tsx` was itself the god-page symptom a later architecture pass named and
 * removed — a hub of "View →" cards sitting above the very sections it linked to, three
 * competing tables of contents for one set of things (grid, anchors, persistent rail). The
 * persistent Settings rail (`features/settings/settings-navigation.tsx`) is now the one index,
 * and every destination below is a real route rather than an anchor a grid pointed at.
 */
describe('Settings, as the Configuration Center (source scan)', () => {
  const navigation = readFileSync(
    fileURLToPath(new URL('../features/settings/settings-navigation.tsx', import.meta.url)),
    'utf8',
  );

  it('groups Personal, Business, Operations, Data & automation, Channels & connections, Commerce and Product separately, never flattened into one list', () => {
    for (const heading of [
      'Personal',
      'Business',
      'Operations',
      'Data & automation',
      'Channels & connections',
      'Commerce',
      'Product',
    ]) {
      expect(navigation).toContain(`heading: '${heading}'`);
    }
  });

  it('carries none of the retired mixed-concept labels', () => {
    for (const retired of ['Work & scheduling', 'Public presence & payments', 'Data & automation']) {
      // "Data & automation" survives as a group heading (one coherent question, two tabs on one
      // route) — the retired thing is a *nav entry* by that name mixing unrelated concerns, not
      // the heading itself.
      if (retired === 'Data & automation') {
        expect(navigation).not.toContain(`label: '${retired}'`);
        continue;
      }
      expect(navigation).not.toContain(retired);
    }
  });

  it('splits Work from Schedule, and Branding from Payments, into their own routes', () => {
    expect(navigation).toContain("segment: 'schedule'");
    expect(navigation).toContain("segment: 'branding'");
    expect(readFileSync(`${ROUTES}/settings/schedule/page.tsx`, 'utf8')).toContain(
      'ScheduleConfigurationPage',
    );
    expect(readFileSync(`${ROUTES}/settings/branding/page.tsx`, 'utf8')).toContain(
      'BrandingSettingsPage',
    );
    // Opening hours moved out of Settings → Work entirely.
    expect(readFileSync(`${ROUTES}/settings/work/page.tsx`, 'utf8')).not.toContain(
      'listOperatingHours',
    );
  });

  it('reaches Work configuration', () => {
    expect(navigation).toContain("segment: 'work'");
    expect(readFileSync(`${ROUTES}/settings/work/page.tsx`, 'utf8')).toContain('WorkConfigurationPage');
  });

  it('reaches Business commerce, which reuses Pricing’s own content', () => {
    expect(navigation).toContain("segment: 'commerce'");
    expect(readFileSync(`${ROUTES}/settings/commerce/page.tsx`, 'utf8')).toContain('CreatePriceItemForm');
  });

  it('reaches Data & automation, which reuses the Automations screen’s own content', () => {
    expect(navigation).toContain("segment: 'data-automation'");
    expect(readFileSync(`${ROUTES}/settings/data-automation/page.tsx`, 'utf8')).toContain(
      'CreateAutomationRuleForm',
    );
  });

  it('reaches Custom fields, under Data & automation', () => {
    expect(readFileSync(`${ROUTES}/settings/data-automation/page.tsx`, 'utf8')).toContain('CreateFieldForm');
  });

  it('reaches People & access', () => {
    expect(navigation).toContain("segment: 'people'");
    expect(readFileSync(`${ROUTES}/settings/people/page.tsx`, 'utf8')).toContain('AddMemberForm');
  });

  it('sends every retired top-level route to its new home rather than a dead end', () => {
    for (const [segment, destination] of [
      ['roles', 'settings/people'],
      ['fields', 'settings/data-automation'],
      ['automations', 'settings/data-automation'],
      ['pricing', 'settings/commerce'],
    ] as const) {
      const page = readFileSync(`${ROUTES}/${segment}/page.tsx`, 'utf8');
      expect(page, `${segment} no longer redirects to ${destination}`).toContain(destination);
    }
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
  const work = `${readFileSync(`${ROUTES}/work/page.tsx`, 'utf8')}\n${readFileSync(`${WEB_ROOT}/features/work/work-list.tsx`, 'utf8')}`;

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
