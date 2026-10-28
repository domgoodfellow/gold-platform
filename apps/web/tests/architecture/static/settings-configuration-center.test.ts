import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { legacyPaymentSettingsHref } from '@/lib/route/settings';

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
  // There is no Organization directory page any more: the Settings sidebar lists cross-workspace
  // administration, and search reaches the configuration workspaces own through the shell's search
  // index, built from the same configuration map by the shell that mounts the sidebar.
  const settings = readFileSync(fileURLToPath(new URL('../../../features/shell/organization-shell.tsx', import.meta.url)), 'utf8');
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
    expect(settings).toContain('projectSettingsNav');
    for (const path of [
      'settings/general',
      'settings/branding',
      'comms/configuration/messaging',
      'settings/features',
      'settings/plan',
    ]) {
      expect(map).toContain(path);
    }
  });

  it('does not claim Account, Work configuration, or Schedule configuration as Settings destinations', () => {
    const nav = readFileSync(fileURLToPath(new URL('../../../lib/settings-nav.ts', import.meta.url)), 'utf8');
    expect(nav).not.toContain('/settings/work');
    expect(nav).not.toContain('/settings/schedule');
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

describe('configuration fields stay with their owning surfaces', () => {
  it('keeps General limited to organization identity and regional settings', () => {
    const general = readFileSync(`${WEB_FEATURES}/tenancy/organization-settings-form.tsx`, 'utf8');
    expect(general).toContain('name="name"');
    expect(general).toContain('BusinessLocationFields');
    expect(general).toContain('name="legalName"');
    expect(general).not.toContain('bufferMinutes');
    expect(general).not.toContain('slug');
    expect(general).not.toContain('Public booking address');
    expect(general).not.toContain('Time a resource stays busy after a job');
  });

  it('renders the scheduling buffer in Schedule configuration', () => {
    const schedule = readFileSync(
      `${WEB_FEATURES}/scheduling/configuration/schedule-configuration.tsx`,
      'utf8',
    );
    expect(schedule).toContain('ScheduleBufferForm');
  });

  it('renders the public booking address in Domains, outside ProfileForm and Branding', () => {
    const domains = readFileSync(`${ROUTES}/settings/domains/page.tsx`, 'utf8');
    const branding = readFileSync(`${ROUTES}/settings/branding/page.tsx`, 'utf8');
    const profile = readFileSync(`${WEB_FEATURES}/public-profile/profile-form.tsx`, 'utf8');
    expect(domains).toContain('PublicBookingAddressForm');
    expect(branding).not.toContain('PublicBookingAddressForm');
    expect(profile).not.toContain('/book/');
    expect(profile).not.toContain('hasBookableType');
    expect(profile).not.toContain('slug');
  });

  it('renders the public profile in its own route, and Branding owns visual identity only', () => {
    const publicProfile = readFileSync(`${ROUTES}/settings/public-profile/page.tsx`, 'utf8');
    const branding = readFileSync(`${ROUTES}/settings/branding/page.tsx`, 'utf8');
    expect(publicProfile).toContain('ProfileForm');
    expect(branding).not.toContain('ProfileForm');
    expect(branding).toContain('BrandEditor');
  });
});

/**
 * The four canonical workspaces this slice restored â€” each a real top-level Area again, with
 * the content that had accreted under Settings while it was one, and each old Settings route now
 * only a compatibility redirect.
 */
describe('Pricing, Automations, Custom fields and Team are canonical, not Settings sub-routes', () => {
  it('the price book is the operating Catalog & Pricing page, General owns currency and Customer payments owns getting paid', () => {
    const catalog = readFileSync(`${ROUTES}/finance/catalog/page.tsx`, 'utf8');
    expect(catalog).toContain('PricingManagement');
    expect(catalog).toContain("requireOperatingArea(organizationId, 'finance-catalog')");
    expect(catalog).toContain('/settings/payments');
    expect(catalog).toContain('/settings/general#regional-heading');
    const general = readFileSync(`${ROUTES}/settings/general/page.tsx`, 'utf8');
    // One editor per setting: General no longer renders payment collection or the business words editor.
    expect(general).not.toContain('<GettingPaidSection');
    expect(general).not.toContain('<BusinessProfileSettings');
    expect(general).toContain("'getting-paid'");
    const payments = readFileSync(`${ROUTES}/settings/payments/page.tsx`, 'utf8');
    expect(payments).toContain('<GettingPaidSection');
    expect(payments).toContain("requireConfigurationTarget(organizationId, 'payments')");
    const section = readFileSync(`${WEB_FEATURES}/pricing/getting-paid-section.tsx`, 'utf8');
    expect(section).toContain('PaymentAccountRow');
    expect(section).toContain('id="getting-paid"');
    // Customer collection is never the GildOps subscription: that is Plan & usage, only linked.
    expect(section).not.toMatch(/subscription|platform_plans|getPlan/);
    const terminology = readFileSync(`${ROUTES}/settings/terminology/page.tsx`, 'utf8');
    expect(terminology).toContain('<BusinessProfileSettings');
    expect(terminology).toContain("requireConfigurationTarget(organizationId, 'terminology')");
    // A plain HTTP redirect (so the browser carries `#getting-paid` across it), with a relative Location.
    const pricing = readFileSync(`${ROUTES}/finance/configuration/pricing/route.ts`, 'utf8');
    expect(pricing).toContain('status: 307');
    expect(pricing).toContain('headers: { Location: `${legacyPaymentSettingsHref(');
    expect(existsSync(`${ROUTES}/finance/configuration/pricing/page.tsx`)).toBe(false);
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
    expect(detail).toContain('RuleBuilder');
    const builder = readFileSync(`${WEB_FEATURES}/automations/rules/rule-builder.tsx`, 'utf8');
    expect(builder).toContain('RuleHeading');
    expect(builder).toContain('AddConditionSheet');
    expect(builder).toContain('AddActionSheet');
    expect(builder).toContain('/activity?when=all&rule=');
  });

  it('/fields is canonical and renders the shared, entity-scoped fields component', () => {
    const page = readFileSync(`${ROUTES}/settings/custom-fields/page.tsx`, 'utf8');
    expect(page).toContain('EntityFieldsConfiguration');
    expect(page).toContain("'sales/configuration/fields'");
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
    expect(page).toContain('AddMemberDialogProvider');
    expect(page).toContain('MembersTable');
    expect(page).toContain('InvitationsTable');
    expect(page).toContain('RolesTable');
    expect(page).toContain('CreateRoleSheet');
    expect(page).not.toContain('CreateRoleForm');
    expect(page).not.toContain('./pending-invitations');
    expect(page).not.toContain('<PendingInvitations');

    const membersTable = readFileSync(`${WEB_FEATURES}/team/members-table.tsx`, 'utf8');
    expect(membersTable).toContain('RoleAssignmentControl');

    const addMemberDialog = readFileSync(`${WEB_FEATURES}/team/add-member-dialog.tsx`, 'utf8');
    expect(addMemberDialog).toContain('AddMemberForm');
    expect(addMemberDialog).toContain('InviteMemberForm');

    const rolesTable = readFileSync(`${WEB_FEATURES}/team/roles-table.tsx`, 'utf8');
    expect(rolesTable).toContain('EditRoleSheet');
  });

  it('sends every retired Settings sub-route to its new canonical home, never a dead end', () => {
    for (const [segment, destination] of [
      ['settings/people', 'settings/access'],
      ['settings/data-automation', 'settings/custom-fields'],
    ] as const) {
      const page = readFileSync(`${ROUTES}/${segment}/page.tsx`, 'utf8');
      expect(page, `${segment} no longer redirects to ${destination}`).toContain(`/${destination}`);
      expect(page).toContain('redirect(');
    }
    // Commerce held card payments: it lands on Customer payments, or General for a member who cannot manage it.
    const commerce = readFileSync(`${ROUTES}/settings/commerce/page.tsx`, 'utf8');
    expect(commerce).toContain('redirect(legacyPaymentSettingsHref(');
    expect(commerce).toContain("configurationTargetOffered(organizationId, 'payments')");
    expect(legacyPaymentSettingsHref('org', true)).toBe('/organizations/org/settings/payments');
    expect(legacyPaymentSettingsHref('org', false)).toBe('/organizations/org/settings/general');
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
    expect(map).toMatch(/key:\s*'website'.*path:\s*'studio\/website'/);
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
    ]) {
      const source = readFileSync(
        fileURLToPath(new URL(`../../../${spec.component}`, import.meta.url)),
        'utf8',
      );
      expect(source).toContain('EntityFieldsConfiguration');
      expect(source).not.toContain('CreateFieldForm');
    }
    expect(readFileSync(`${ROUTES}/crm/configuration/fields/page.tsx`, 'utf8')).toContain('EntityFieldsConfiguration');
    // Package 3A retired Customers' link-only Configure panel; customer fields are configured on their CRM page only.
    expect(readFileSync(`${ROUTES}/crm/contacts/page.tsx`, 'utf8')).not.toContain('ConfigureRegistrar');
  });

  it('Schedule swapped the raw date input for the shared Calendar/Popover DatePicker', () => {
    // Calendar navigation is shared across domains; routes only supply context.
    const schedulePage = readFileSync(`${ROUTES}/schedule/page.tsx`, 'utf8');
    expect(schedulePage).not.toContain('type="date"');
    const toolbar = readFileSync(
      fileURLToPath(new URL('../../../components/calendar/calendar-workspace.tsx', import.meta.url)),
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
    for (const kept of ['NewWorkAction', 'MoveWorkItemForm', '/work/dispatch']) {
      expect(work).toContain(kept);
    }
  });

  it('shows a configuration-link empty state, not a mysteriously empty board, when nothing is configured', () => {
    expect(work).toContain('No work types yet');
    expect(work).toMatch(/work\/configuration/);
    // The link is offered only to somebody who could act on it â€” a member who cannot configure
    // work is not shown a control dressed up as one (the UI-is-not-authorization rule, applied to navigation rather than a
    // write).
    expect(work).toMatch(/mayConfigure\s*\?[\s\S]{0,220}Set up work types/);
  });
});

describe('Business Setupâ€™s manual links (source scan)', () => {
  it('points its Work step at Work configuration, not the operational board', () => {
    // The area list is the domain's (`computeSetupOverview`), so the link is read from there.
    const overview = readFileSync(`${WEB_ROOT}lib/domain/tenancy/lifecycle.ts`, 'utf8');
    expect(overview).toMatch(/'work',\s*'work',\s*`\$\{areaHref\(organizationId, 'work'\)\}\/configuration`/);
  });
});
