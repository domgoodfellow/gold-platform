import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Settings as the Configuration Center, and Work split into operating it versus defining it
 * (product reality audit, Slice 3).
 *
 * **Structural claims are a source scan**, for the reason `layout.test.ts` and `navigation.test.ts`
 * already give for the same choice: these are facts about which JSX a server component renders,
 * and this repository runs no harness that mounts one. **The one authorization claim is real
 * Postgres**, because a hub that merely links to an existing page cannot itself grant anything â€”
 * proving that requires actually trying the write as a member who shouldn't be able to. That one
 * lives in `settings-configuration-authority.test.ts`, because it needs a database and this file
 * does not.
 */

const ROUTES = fileURLToPath(new URL('../../../app/organizations/[organizationId]', import.meta.url));
const WEB_FEATURES = fileURLToPath(new URL('../../../features', import.meta.url));
const WEB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('Settings, as the Configuration Center (source scan)', () => {
  // The Configuration Center is `/settings/organization` — the organization directory
  // `SettingsIndex` renders. `/settings` itself is the landing page, a chooser between five
  // destinations (Organization among them), not the configuration map.
  const settings = readFileSync(`${ROUTES}/settings/organization/page.tsx`, 'utf8');
  const frame = readFileSync(
    fileURLToPath(new URL('../../../features/settings/settings-page-frame.tsx', import.meta.url)),
    'utf8',
  );

  it('uses the existing app page frame, not a permanent second Settings sidebar', () => {
    expect(frame).not.toContain('SettingsNavigation');
    expect(frame).not.toContain('grid-cols-[13rem_minmax(0,1fr)]');
  });

  it('links the Settings-owned destinations from the map the hub renders', () => {
    // Paths are declared once, on the configuration targets the map reads by key.
    const map = readFileSync(
      fileURLToPath(new URL('../../../lib/navigation.ts', import.meta.url)),
      'utf8',
    );
    expect(settings).toContain('offeredSections');
    for (const path of [
      'settings/general',
      'settings/branding',
      'settings/communications',
      'settings/features',
      'settings/plan',
    ]) {
      expect(map).toContain(path);
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
    const page = readFileSync(`${ROUTES}/settings/pricing/page.tsx`, 'utf8');
    expect(page).toContain('CreatePriceItemForm');
    expect(page).toContain('EditPriceItemForm');
    expect(page).toContain('PaymentAccountRow');
    expect(page).not.toContain('redirect(');
  });

  it('/automations is canonical Automations Home; Rules, Messages and Activity are its three pages, and a rule is its own detail route', () => {
    const page = readFileSync(`${ROUTES}/automations/page.tsx`, 'utf8');
    // Home summarizes the three pages rather than rendering Rules itself — a Home is never a
    // page's content wearing the parent's address.
    expect(page).not.toContain('RulesTable');
    expect(page).not.toContain('NewAutomationSheet');
    // The sidebar is the one navigation for the three: no tab strip over the same routes.
    expect(page).not.toMatch(/AutomationsViewTabs|MessagesView|ActivityView/);
    expect(existsSync(`${WEB_FEATURES}/automations/workspace/view-tabs.tsx`)).toBe(false);
    // The old ?view= addresses still land somewhere: on the pages that replaced them.
    expect(page).toContain("redirect(areaHref(organizationId, 'automation-messages'))");
    expect(page).toContain("redirect(areaHref(organizationId, 'automation-activity'))");
    expect(page).not.toContain('AutomationRuleCard');

    const rules = readFileSync(`${ROUTES}/automations/rules/page.tsx`, 'utf8');
    expect(rules).toContain('RulesTable');
    expect(rules).toContain('NewAutomationSheet');
    expect(readFileSync(`${ROUTES}/automations/messages/page.tsx`, 'utf8')).toContain('MessagesView');
    expect(readFileSync(`${ROUTES}/automations/activity/page.tsx`, 'utf8')).toContain('ActivityView');

    const detail = readFileSync(`${ROUTES}/automations/[ruleId]/page.tsx`, 'utf8');
    expect(detail).toContain('RuleHeading');
    expect(detail).toContain('ConditionList');
    expect(detail).toContain('ActionList');
    expect(detail).toContain('RuleActivity');
  });

  it('/fields is canonical and renders the shared, entity-scoped fields component', () => {
    const page = readFileSync(`${ROUTES}/settings/custom-fields/page.tsx`, 'utf8');
    expect(page).toContain('EntityFieldsConfiguration');
    expect(page).not.toContain('redirect(');
    expect(
      readFileSync(
        fileURLToPath(new URL('../../../features/custom-fields/configuration/entity-fields-configuration.tsx', import.meta.url)),
        'utf8',
      ),
    ).toContain('CreateFieldSheet');
  });

  it('/roles is canonical and renders the Team workspace â€” Members, Invitations and Roles as URL-backed sibling views', () => {
    const page = readFileSync(`${ROUTES}/settings/access/access-page.tsx`, 'utf8');
    expect(page).toContain('<ViewNav');
    expect(page).toContain('AddMemberSheetProvider');
    expect(page).toContain('MembersTable');
    expect(page).toContain('InvitationsTable');
    expect(page).toContain('RolesTable');
    expect(page).toContain('CreateRoleSheet');
    expect(page).not.toContain('CreateRoleForm');
    expect(page).not.toContain('./pending-invitations');
    expect(page).not.toContain('<PendingInvitations');

    const membersTable = readFileSync(`${WEB_FEATURES}/team/members-table.tsx`, 'utf8');
    expect(membersTable).toContain('RoleAssignmentControl');

    const addMemberSheet = readFileSync(`${WEB_FEATURES}/team/add-member-sheet.tsx`, 'utf8');
    expect(addMemberSheet).toContain('AddMemberForm');
    expect(addMemberSheet).toContain('InviteMemberForm');

    const rolesTable = readFileSync(`${WEB_FEATURES}/team/roles-table.tsx`, 'utf8');
    expect(rolesTable).toContain('EditRoleSheet');
  });

  it('sends every retired Settings sub-route to its new canonical home, never a dead end', () => {
    for (const [segment, destination] of [
      ['settings/people', 'settings/access'],
      ['settings/data-automation', 'settings/custom-fields'],
      ['settings/commerce', 'settings/pricing'],
    ] as const) {
      const page = readFileSync(`${ROUTES}/${segment}/page.tsx`, 'utf8');
      expect(page, `${segment} no longer redirects to ${destination}`).toContain(`/${destination}`);
      expect(page).toContain('redirect(');
    }
  });
});

describe('Website is a canonical Studio operating page, not a Settings sub-route', () => {
  it('studio/website is the workbench, not a link wrapped in one more card', () => {
    const page = readFileSync(`${ROUTES}/studio/website/page.tsx`, 'utf8');
    expect(page).toContain('WebsiteWorkbench');
    expect(page).not.toContain('redirect(');
  });

  it('settings/website only redirects to the canonical route, for an old bookmark', () => {
    const page = readFileSync(`${ROUTES}/settings/website/page.tsx`, 'utf8');
    expect(page).toContain('redirect(');
    expect(page).toContain('/studio/website');
    expect(page).not.toContain('WebsiteWorkbench');
  });

  it('the website config target is retired from the Settings map â€” Website is reached from Studio Home, not Settings', () => {
    const map = readFileSync(
      fileURLToPath(new URL('../../../lib/navigation.ts', import.meta.url)),
      'utf8',
    );
    expect(map).not.toMatch(/key:\s*'website'/);
    expect(map).toContain("segment: 'studio-website'");
  });

  it('the private preview backlink returns to Studio, not Settings', () => {
    const preview = readFileSync(
      fileURLToPath(new URL('../../../app/(preview)/preview/[organizationId]/[revisionId]/[[...page]]/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(preview).toContain('/studio/website');
    expect(preview).not.toContain('/settings/website');
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
      component: 'features/crm/customers/customer-configuration.tsx',
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
        readFileSync(fileURLToPath(new URL(`../../../${spec.component}`, import.meta.url)), 'utf8'),
        `${spec.component} should exist`,
      ).toContain(`export function ${spec.import}`);
    }
  });

  it('ConfigureRegistrar itself is shared infrastructure, not owned by Work', () => {
    expect(
      readFileSync(
        fileURLToPath(new URL('../../../components/panels/configure-registrar.tsx', import.meta.url)),
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
        fileURLToPath(new URL(`../../../${spec.component}`, import.meta.url)),
        'utf8',
      );
      expect(source).toContain('EntityFieldsConfiguration');
      expect(source).not.toContain('CreateFieldForm');
    }
  });

  it('Schedule swapped the raw date input for the shared Calendar/Popover DatePicker', () => {
    // The control itself lives in Schedule's own feature-owned toolbar now, not the route.
    const schedulePage = readFileSync(`${ROUTES}/schedule/page.tsx`, 'utf8');
    expect(schedulePage).not.toContain('type="date"');
    const toolbar = readFileSync(
      fileURLToPath(new URL('../../../features/scheduling/calendar/schedule-toolbar.tsx', import.meta.url)),
      'utf8',
    );
    expect(toolbar).not.toContain('type="date"');
    expect(toolbar).toContain('DatePicker');
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
    expect(work).toContain('No work types yet');
    expect(work).toMatch(/work\/configuration/);
    // The link is offered only to somebody who could act on it â€” a member who cannot configure
    // work is not shown a control dressed up as one (I12, applied to navigation rather than a
    // write).
    expect(work).toMatch(/mayConfigure\s*\?[\s\S]{0,220}Configure work/);
  });
});

describe('Business Setupâ€™s manual links (source scan)', () => {
  it('points its Work step at Work configuration, not the operational board', () => {
    // The area list is the domain's (`computeSetupOverview`), so the link is read from there.
    const overview = readFileSync(`${WEB_ROOT}lib/domain/tenancy/lifecycle.ts`, 'utf8');
    expect(overview).toMatch(/'work',\s*'work',\s*`\$\{areaHref\(organizationId, 'work'\)\}\/configuration`/);
  });
});
