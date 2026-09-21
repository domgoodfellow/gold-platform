import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * SETUP AS AN ORGANIZATION LIFECYCLE — entry, cockpit, shell treatment, Launch, and what LIVE
 * stops showing.
 *
 * **Source scans, for the reason `layout.test.ts` gives**: an async server component has no
 * rendering harness this repository runs, so which control renders under which state is read from
 * the file. The behaviour underneath — the overview's areas, importance and Launch's refusal — is
 * proven against real Postgres in `lifecycle.test.ts`, and the entry decision itself as a pure
 * function in `landing.test.ts`.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const SETUP_PAGE = read('../../../app/organizations/[organizationId]/setup/page.tsx');
const SETUP_ACTIONS = read('../../../app/organizations/[organizationId]/setup/actions.ts');
const COCKPIT = read('../../../features/setup/setup-cockpit.tsx');
const SHELL = read('../../../app/organizations/[organizationId]/org-shell.tsx');
const LAYOUT = read('../../../app/organizations/[organizationId]/layout.tsx');
const PLATFORM_LAYOUT = read('../../../app/(platform)/platform/layout.tsx');
const TODAY_FEATURE = read('../../../features/today/today-dashboard.tsx');
const CREATE_ACTION = read('../../../app/organizations/actions.ts');
const NAVIGATION = read('../../../lib/navigation.ts');

describe('entry — one decision, made in one place', () => {
  it('organizationHomeHref takes the lifecycle state and sends SETUP to Setup', () => {
    expect(NAVIGATION).toMatch(
      /organizationHomeHref\(organizationId: string, operationalState: OperationalState\)/,
    );
    expect(NAVIGATION).toContain("operationalState === 'setup' ? 'setup' : AREAS[0].segment");
  });

  it('a newly created business enters through it, without asking whether drafting exists', () => {
    expect(CREATE_ACTION).toContain("organizationHomeHref(organizationId, 'setup')");
    expect(CREATE_ACTION).not.toContain('canDraftConfiguration');
  });

  it('no caller decides the setup-versus-today question for itself', () => {
    for (const source of [CREATE_ACTION, read('../../../app/organizations/page.tsx'), read('../../../lib/route/landing.ts')]) {
      expect(source).not.toMatch(/areaHref\([^)]*'(setup|today)'\)/);
    }
  });

  it('SETUP is not a route prison — no page redirects a setup business away from another area', () => {
    for (const area of ['today', 'work', 'schedule', 'settings']) {
      const page = read(`../../../app/organizations/[organizationId]/${area}/page.tsx`);
      expect(page, `${area} redirects on lifecycle state`).not.toMatch(/redirect\([^)]*setup/);
    }
  });
});

describe('the cockpit — a map of existing configuration, not a second model', () => {
  it('builds its areas from computeSetupOverview and holds no field of any workspace', () => {
    expect(SETUP_PAGE).toContain('computeSetupOverview');
    expect(SETUP_PAGE).not.toMatch(/<(TextInput|SelectInput|TextArea)/);
    expect(COCKPIT).not.toMatch(/<(input|form|TextInput|SelectInput|TextArea)/);
  });

  it('shows progress as a count of areas, with the semantic count leading', () => {
    expect(COCKPIT).toContain('setup areas ready');
    expect(COCKPIT).toContain("from '@gold/ui/components/progress'");
    expect(COCKPIT.indexOf('{overview.ready} of {overview.total}')).toBeLessThan(COCKPIT.indexOf('<Progress'));
  });

  it('names importance and state in words, never by colour alone', () => {
    for (const word of ['Ready', 'Blocks launch', 'Recommended', 'Optional']) {
      expect(COCKPIT).toContain(`'${word}'`);
    }
  });

  it('uses the Slice 1 PageHeader and no second heading', () => {
    expect(SETUP_PAGE).toContain('<PageHeader');
    expect(SETUP_PAGE).not.toMatch(/<PageHeading/);
  });
});

describe('Launch — a review boundary, not a mystery button', () => {
  it('renders no Launch control at all while a blocker stands, and lists each with its owning link', () => {
    const blocked = COCKPIT.slice(COCKPIT.indexOf('blocked ? ('), COCKPIT.indexOf(') : ('));
    expect(blocked).toContain('overview.blockers.map');
    expect(blocked).toContain('href={area.area.href}');
    expect(blocked).not.toContain('{launch}');
    expect(COCKPIT).not.toMatch(/disabled=/);
  });

  it('states what Launch will do and how much is left, before the control', () => {
    expect(COCKPIT).toContain('Required setup');
    expect(COCKPIT).toContain('Recommendations');
    expect(COCKPIT).toContain('Optional areas');
    expect(COCKPIT).toContain('Launching makes Today the default workspace');
    expect(COCKPIT.indexOf('Launching makes Today')).toBeLessThan(COCKPIT.indexOf('{launch}'));
  });

  it('only offers Launch while SETUP, and the domain re-checks regardless of the page', () => {
    expect(SETUP_PAGE).toMatch(/inSetup \? \(\s*<LaunchReview/);
    expect(SETUP_ACTIONS).toContain('launchOrganization(db, { organizationId })');
  });

  it('lands on Today after a successful Launch, and revalidates the shell so Setup leaves it', () => {
    expect(SETUP_ACTIONS).toContain("organizationHomeHref(organizationId, 'live')");
    expect(SETUP_ACTIONS).toContain("revalidatePath(`/organizations/${organizationId}`, 'layout')");
    // A failed Launch returns its message before any redirect.
    expect(SETUP_ACTIONS.indexOf('if (result.error) return result;')).toBeLessThan(
      SETUP_ACTIONS.indexOf("redirect(organizationHomeHref(organizationId, 'live'))"),
    );
  });
});

describe('AI drafting — an accelerator the cockpit does not depend on', () => {
  it('sits in its own optional section and keeps the review-and-apply path', () => {
    expect(SETUP_PAGE).toContain('Set up faster with Agent');
    expect(SETUP_PAGE).toContain('<ProposalReview');
    expect(SETUP_PAGE).toContain('nothing takes effect until you apply it');
  });

  it('renders the areas and Launch outside every drafting condition', () => {
    const agentStart = SETUP_PAGE.indexOf('{draftingOn ? (');
    expect(agentStart).toBeGreaterThan(-1);
    expect(SETUP_PAGE.indexOf('<SetupAreaList')).toBeLessThan(agentStart);
    expect(SETUP_PAGE.indexOf('<LaunchReview')).toBeLessThan(agentStart);
  });

  it('says so, and points at the areas, when this installation cannot draft', () => {
    expect(SETUP_PAGE).toContain('This installation cannot draft a setup.');
    expect(SETUP_PAGE).toContain('Every area above can still be configured');
  });
});

describe('the shell — one lifecycle treatment at every width, gone at LIVE', () => {
  it('reads the lifecycle state once and hands both renderings the same progress', () => {
    expect(LAYOUT).toContain("organization.operationalState === 'setup'");
    expect(LAYOUT.match(/setup=\{setup\}/g) ?? []).toHaveLength(2);
    // Platform Administration is not a business, so it has no lifecycle treatment at all.
    expect(PLATFORM_LAYOUT).not.toMatch(/SetupEntry|SetupNavLink|setup={/);
  });

  it('gives a phone a path to Setup as the bottom bar’s own item, only while a progress value exists', () => {
    const bar = SHELL.slice(SHELL.indexOf('export function OrgNavBar('), SHELL.indexOf('export function SetupEntry'));
    expect(bar).toMatch(/\{setup \? \(\s*<li[^>]*>\s*<SetupNavLink/);
    expect(SHELL).toContain('export function SetupNavLink');
  });

  it('carries no Setup badge or header treatment, and no giant call to action', () => {
    expect(SHELL).not.toContain('SetupBadge');
    expect(SHELL).not.toContain('Set up your business');
    expect(LAYOUT).not.toContain('Setting up');
    expect(SHELL).not.toContain('bg-accent text-on-accent hover:bg-accent');
  });

  it('never puts Setup in the permanent area lists', () => {
    expect(NAVIGATION).toMatch(/segment: 'setup'[^}]*sidebar: false/);
  });
});

describe('Today — the operating cockpit, not a second onboarding dashboard', () => {
  it('carries no setup chrome of its own — the sidebar row and Setup itself are the lifecycle', () => {
    // A setup business enters through Setup (`organizationHomeHref`), and the sidebar keeps one
    // row for it; a third sentence on Today would be the competing affordance this replaced.
    expect(TODAY_FEATURE).not.toMatch(/being set up|Continue setup|setupRemaining|inSetup|blockers|warnings/);
  });
});
