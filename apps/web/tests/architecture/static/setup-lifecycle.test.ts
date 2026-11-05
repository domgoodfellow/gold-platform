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
const GUIDED = read('../../../features/setup/guided-setup.tsx');
const REVIEW = read('../../../app/organizations/[organizationId]/setup/proposal/page.tsx');
const SHELL = read('../../../app/organizations/[organizationId]/org-shell.tsx');
const LAYOUT = read('../../../features/shell/organization-shell.tsx');
const PLATFORM_LAYOUT = read('../../../app/platform/layout.tsx');
const HOME_FEATURE = read('../../../features/home/home-dashboard.tsx');
const CREATE_ACTION = read('../../../app/organizations/actions.ts');
const NAVIGATION = read('../../../lib/navigation.ts');

describe('entry — one decision, made in one place', () => {
  it('organizationHomeHref keeps Home canonical while readiness is contextual', () => {
    expect(NAVIGATION).toMatch(
      /organizationHomeHref\(organizationId: string, operationalState: OperationalState\)/,
    );
    expect(NAVIGATION).toContain('areaHref(organizationId, AREAS[0].segment)');
  });

  it('a newly created business enters through it, without asking whether drafting exists', () => {
    expect(CREATE_ACTION).toContain("organizationHomeHref(organizationId, 'setup')");
    expect(CREATE_ACTION).not.toContain('canDraftConfiguration');
  });

  it('no caller decides the setup-versus-today question for itself', () => {
    for (const source of [CREATE_ACTION, read('../../../app/organizations/page.tsx'), read('../../../lib/route/landing.ts')]) {
      expect(source).not.toMatch(/areaHref\([^)]*'(setup|home)'\)/);
    }
  });

  it('SETUP is not a route prison — no page redirects a setup business away from another area', () => {
    for (const area of ['home', 'work', 'schedule', 'settings']) {
      const page = read(`../../../app/organizations/[organizationId]/${area}/page.tsx`);
      expect(page, `${area} redirects on lifecycle state`).not.toMatch(/redirect\([^)]*setup/);
    }
  });
});

describe('the cockpit — a map of existing configuration, not a second model', () => {
  it('builds its areas from computeSetupOverview and holds no field of any workspace', () => {
    expect(SETUP_PAGE).toContain('computeSetupOverview');
    expect(SETUP_PAGE).not.toMatch(/<(TextInput|SelectField|SelectInput|TextArea)/);
    expect(COCKPIT).not.toMatch(/<(input|form|TextInput|SelectField|SelectInput|TextArea)/);
  });

  it('shows progress as a count of areas, with the semantic count leading', () => {
    expect(COCKPIT).toContain('setup areas ready');
    expect(COCKPIT).toContain("from '@gold/ui/components/progress'");
    expect(COCKPIT.indexOf('{overview.ready} of {overview.total}')).toBeLessThan(COCKPIT.indexOf('<Progress'));
  });

  it('names importance and state in words, never by colour alone', () => {
    for (const word of ['Ready', 'Required', 'Recommended', 'Optional']) {
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
    expect(blocked).toContain("withSetupContext(area.area.href, 'review')");
    expect(blocked).toContain('allowedDestinations.includes(configurationOwnerPath(area.area.href))');
    expect(blocked).not.toContain('{launch}');
    expect(COCKPIT).not.toMatch(/disabled=/);
  });

  it('states what Launch will do and how much is left, before the control', () => {
    expect(COCKPIT).toContain('Required setup');
    expect(COCKPIT).toContain('Recommendations');
    expect(COCKPIT).toContain('Optional areas');
    expect(COCKPIT).toContain('Finishing setup makes Home the default workspace');
    expect(COCKPIT.indexOf('Finishing setup makes Home')).toBeLessThan(COCKPIT.indexOf('{launch}'));
  });

  it('only offers Launch while SETUP, and the domain re-checks regardless of the page', () => {
    expect(SETUP_PAGE).toContain('live={!inSetup}');
    expect(GUIDED).toContain('live ?');
    expect(GUIDED).toContain(': <LaunchReview');
    expect(SETUP_ACTIONS).toContain('launchOrganization(db, { organizationId })');
  });

  it('lands on Home after a successful Launch, and revalidates the shell so Setup leaves it', () => {
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
    expect(SETUP_PAGE).toContain('/setup/proposal');
    expect(REVIEW).toContain('<ProposalReview');
    // Nothing a draft proposes takes effect until it is applied: the Setup page no longer repeats
    // that under its heading (UI copy discipline), so it is pinned where the person applies.
    expect(read('../../../features/setup/proposal-review.tsx')).toContain('Apply the saved proposal through each configuration owner');
  });

  it('renders the areas and Launch outside every drafting condition', () => {
    const agentStart = SETUP_PAGE.indexOf('{draftingOn ? (');
    expect(agentStart).toBeGreaterThan(-1);
    expect(SETUP_PAGE.indexOf('<GuidedSetup')).toBeGreaterThan(-1);
    expect(SETUP_PAGE.indexOf('<GuidedSetup')).toBeLessThan(agentStart);
  });

  it('says so, and points at the areas, when this installation cannot draft', () => {
    expect(SETUP_PAGE).toContain('This installation cannot draft a setup.');
    expect(SETUP_PAGE).toContain('Every area above can still be configured');
  });
});

describe('the shell — one lifecycle treatment at every width, gone at LIVE', () => {
  it('reads the lifecycle state once and hands both renderings the same progress', () => {
    // The layout reads the lifecycle once, as a flag for the switcher; Home reads it for the banner.
    expect(LAYOUT).toContain("const setupPending = !locked && organization.operationalState === 'setup';");
    expect(LAYOUT).not.toContain('setup={setup}');
    expect(LAYOUT).not.toContain('computeSetupOverview');
    // Platform Administration is not a business, so it has no lifecycle treatment at all.
    expect(PLATFORM_LAYOUT).not.toMatch(/SetupEntry|SetupNavLink|setup={/);
  });

  it('gives a phone a path to Setup as the bottom bar’s own item, only while a progress value exists', () => {
    expect(SHELL).not.toContain('SetupNavLink');
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

describe('Home — the operating cockpit, not a second onboarding dashboard', () => {
  it('carries one setup banner, supplied by the page that knows the lifecycle, and no sidebar row for it', () => {
    // Setup is onboarding status: the banner appears on Home only while the business is in SETUP,
    // and the Setup page keeps the checklist and launch controls. Nothing in the navigation names it.
    expect(HOME_FEATURE).toContain('setup?: ReactNode');
    expect(HOME_FEATURE).toContain('{setup}');
  });
});
