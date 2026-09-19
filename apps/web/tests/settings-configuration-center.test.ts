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
 * Postgres**, because a hub that merely links to an existing page cannot itself grant anything â€”
 * proving that requires actually trying the write as a member who shouldn't be able to.
 */

const ROUTES = fileURLToPath(new URL('../app/organizations/[organizationId]', import.meta.url));
const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('Settings, as the Configuration Center (source scan)', () => {
  const settings = readFileSync(`${ROUTES}/settings/page.tsx`, 'utf8');
  const frame = readFileSync(
    fileURLToPath(new URL('../features/settings/settings-page-frame.tsx', import.meta.url)),
    'utf8',
  );

  it('uses the existing app page frame, not a permanent second Settings sidebar', () => {
    expect(frame).not.toContain('SettingsNavigation');
    expect(frame).not.toContain('grid-cols-[13rem_minmax(0,1fr)]');
  });

  it('links the remaining Settings-owned destinations from the hub', () => {
    for (const path of [
      '/settings/general',
      '/settings/branding',
      '/settings/website',
      '/settings/connections',
      '/settings/features',
      '/settings/plan',
    ]) {
      expect(settings).toContain(path);
    }
  });

  it('does not claim Account, Work configuration, or Schedule configuration as Settings destinations', () => {
    expect(settings).not.toContain('/account');
    expect(settings).not.toContain('/settings/work');
    expect(settings).not.toContain('/settings/schedule');
  });

  it('keeps Branding as Settings-owned while moving Work and Schedule configuration to their owners', () => {
    expect(readFileSync(`${ROUTES}/settings/branding/page.tsx`, 'utf8')).toContain(
      'BrandingSettingsPage',
    );
    expect(readFileSync(`${ROUTES}/work/configuration/page.tsx`, 'utf8')).toContain(
      'WorkConfigurationPage',
    );
    expect(readFileSync(`${ROUTES}/schedule/configuration/page.tsx`, 'utf8')).toContain(
      'ScheduleConfigurationPage',
    );
  });
});

/**
 * The four canonical workspaces this slice restored â€” each a real top-level Area again, with
 * the content that had accreted under Settings while it was one, and each old Settings route now
 * only a compatibility redirect.
 */
describe('Pricing, Automations, Custom fields and Team are canonical, not Settings sub-routes', () => {
  it('/pricing is canonical and renders both the price book and, when connected, Getting paid', () => {
    const page = readFileSync(`${ROUTES}/pricing/page.tsx`, 'utf8');
    expect(page).toContain('CreatePriceItemForm');
    expect(page).toContain('EditPriceItemForm');
    expect(page).toContain('PaymentAccountRow');
    expect(page).not.toContain('redirect(');
  });

  it('/automations is canonical and renders the automation workspace â€” Rules, Messages and Activity as URL-backed sibling views, and a rule as its own detail route', () => {
    const page = readFileSync(`${ROUTES}/automations/page.tsx`, 'utf8');
    expect(page).toContain('AutomationsViewTabs');
    expect(page).toContain('RulesTable');
    expect(page).toContain('NewAutomationSheet');
    expect(page).toContain('MessagesView');
    expect(page).toContain('ActivityView');
    expect(page).not.toContain('redirect(');
    expect(page).not.toContain('AutomationRuleCard');

    const detail = readFileSync(`${ROUTES}/automations/[ruleId]/page.tsx`, 'utf8');
    expect(detail).toContain('RuleHeading');
    expect(detail).toContain('ConditionList');
    expect(detail).toContain('ActionList');
    expect(detail).toContain('RuleActivity');
  });

  it('/fields is canonical and renders the shared, entity-scoped fields component', () => {
    const page = readFileSync(`${ROUTES}/fields/page.tsx`, 'utf8');
    expect(page).toContain('EntityFieldsConfiguration');
    expect(page).not.toContain('redirect(');
    expect(
      readFileSync(
        fileURLToPath(new URL('../features/fields/entity-fields-configuration.tsx', import.meta.url)),
        'utf8',
      ),
    ).toContain('CreateFieldSheet');
  });

  it('/roles is canonical and renders the Team workspace â€” Members, Invitations and Roles as URL-backed sibling views', () => {
    const page = readFileSync(`${ROUTES}/roles/page.tsx`, 'utf8');
    expect(page).toContain('TeamViewTabs');
    expect(page).toContain('AddMemberSheetProvider');
    expect(page).toContain('MembersTable');
    expect(page).toContain('InvitationsTable');
    expect(page).toContain('RolesTable');
    expect(page).toContain('CreateRoleSheet');
    expect(page).not.toContain('redirect(');
    expect(page).not.toContain('CreateRoleForm');
    expect(page).not.toContain('./pending-invitations');
    expect(page).not.toContain('<PendingInvitations');

    const membersTable = readFileSync(`${ROUTES}/roles/members-table.tsx`, 'utf8');
    expect(membersTable).toContain('RoleAssignmentControl');

    const addMemberSheet = readFileSync(`${ROUTES}/roles/add-member-sheet.tsx`, 'utf8');
    expect(addMemberSheet).toContain('AddMemberForm');
    expect(addMemberSheet).toContain('InviteMemberForm');

    const rolesTable = readFileSync(`${ROUTES}/roles/roles-table.tsx`, 'utf8');
    expect(rolesTable).toContain('EditRoleSheet');
  });

  it('sends every retired Settings sub-route to its new canonical home, never a dead end', () => {
    for (const [segment, destination] of [
      ['settings/people', 'roles'],
      ['settings/data-automation', 'fields'],
      ['settings/commerce', 'pricing'],
    ] as const) {
      const page = readFileSync(`${ROUTES}/${segment}/page.tsx`, 'utf8');
      expect(page, `${segment} no longer redirects to ${destination}`).toContain(`/${destination}`);
      expect(page).toContain('redirect(');
    }
  });
});

describe('contextual Configure, generalized from Work â€” the same component, every host', () => {
  const registrants: Record<string, { page: string; component: string; import: string }> = {
    resources: {
      page: 'resources/page.tsx',
      component: 'features/resources/configuration/resource-configuration.tsx',
      import: 'ResourceConfiguration',
    },
    locations: {
      page: 'locations/page.tsx',
      component: 'features/locations/configuration/location-configuration.tsx',
      import: 'LocationConfiguration',
    },
    assets: {
      page: 'assets/page.tsx',
      component: 'features/assets/configuration/asset-configuration.tsx',
      import: 'AssetConfiguration',
    },
    customers: {
      page: 'customers/page.tsx',
      component: 'features/customers/configuration/customer-configuration.tsx',
      import: 'CustomerConfiguration',
    },
    schedule: {
      page: 'schedule/page.tsx',
      component: 'features/scheduling/configuration/schedule-configuration.tsx',
      import: 'ScheduleConfiguration',
    },
  };

  it('registers a Configure panel from the operational page, via the shared ConfigureRegistrar', () => {
    for (const [area, spec] of Object.entries(registrants)) {
      const source = readFileSync(`${ROUTES}/${spec.page}`, 'utf8');
      expect(source, `${area}/page.tsx should register Configure`).toContain('ConfigureRegistrar');
      expect(source, `${area}/page.tsx should render its own ${spec.import}`).toContain(spec.import);
      expect(
        readFileSync(fileURLToPath(new URL(`../${spec.component}`, import.meta.url)), 'utf8'),
        `${spec.component} should exist`,
      ).toContain(`export function ${spec.import}`);
    }
  });

  it('ConfigureRegistrar itself is shared infrastructure, not owned by Work', () => {
    expect(
      readFileSync(
        fileURLToPath(new URL('../components/containers/configure-registrar.tsx', import.meta.url)),
        'utf8',
      ),
    ).toContain('export function ConfigureRegistrar');
  });

  it('every entity-scoped Configure component reuses the one EntityFieldsConfiguration, never a second fields implementation', () => {
    for (const spec of [
      registrants.resources,
      registrants.locations,
      registrants.assets,
      registrants.customers,
    ]) {
      const source = readFileSync(
        fileURLToPath(new URL(`../${spec.component}`, import.meta.url)),
        'utf8',
      );
      expect(source).toContain('EntityFieldsConfiguration');
      expect(source).not.toContain('CreateFieldForm');
    }
  });

  it('Schedule swapped the raw date input for the shared Calendar/Popover DatePicker', () => {
    const schedulePage = readFileSync(`${ROUTES}/schedule/page.tsx`, 'utf8');
    expect(schedulePage).not.toContain('type="date"');
    expect(schedulePage).toContain('DatePicker');
  });
});

describe('Work configuration exists as a real, directly addressable owner route', () => {
  it('has its own page, distinct from the operational Work screen', () => {
    // Existing merely by not throwing â€” `readFileSync` fails loudly if the route was never
    // created, which is the actual claim "directly addressable" reduces to for a file-based
    // router: there is a real `page.tsx` at this path, not only a link that points at one.
    const page = readFileSync(`${ROUTES}/work/configuration/page.tsx`, 'utf8');
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
      expect(work, `${moved} should have moved to Work configuration`).not.toContain(moved);
    }
  });

  it('still renders the operational board and its own forms', () => {
    for (const kept of ['CreateWorkItemForm', 'MoveWorkItemForm', 'ScheduleWorkItemForm']) {
      expect(work).toContain(kept);
    }
  });

  it('shows a configuration-link empty state, not a mysteriously empty board, when nothing is configured', () => {
    expect(work).toContain('No kinds of work are configured.');
    expect(work).toMatch(/work\/configuration/);
    // The link is offered only to somebody who could act on it â€” a member who cannot configure
    // work is not shown a control dressed up as one (I12, applied to navigation rather than a
    // write).
    expect(work).toMatch(/mayConfigure\s*\?[\s\S]{0,120}Configure Work/);
  });
});

describe('Business Setupâ€™s manual links (source scan)', () => {
  it('points its Work step at Work configuration, not the operational board', () => {
    // The area list is the domain's (`computeSetupOverview`), so the link is read from there.
    const overview = readFileSync(`${WEB_ROOT}lib/domain/tenancy/lifecycle.ts`, 'utf8');
    expect(overview).toMatch(/'work',\s*'work',\s*`\$\{areaHref\(organizationId, 'work'\)\}\/configuration`/);
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
