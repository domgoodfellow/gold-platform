import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Screen grammar: Page header → Local view navigation → Toolbar → Content. Source guards, like
 * `workspace-shell.test.ts` — nothing here mounts a component. The rendered result was checked in
 * a browser at desktop and phone widths.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const UI = fileURLToPath(new URL('../../../../../packages/ui/src/components', import.meta.url));
const ORG = `${WEB}/app/organizations/[organizationId]`;
const read = (path: string) => readFileSync(path, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sources = (root: string): { path: string; text: string }[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx$/.test(entry.name) ? [{ path, text: read(path) }] : [];
  });

describe('sibling views are navigation, not page actions', () => {
  const viewNav = read(`${WEB}/components/containers/view-nav.tsx`);

  it('ViewNav is link-based, URL-backed and shares the tabs look through one style module', () => {
    expect(viewNav).toContain("from '@gold/ui/components/tab-styles'");
    expect(viewNav).toContain("aria-current={view.key === current ? 'page' : undefined}");
    expect(viewNav).not.toContain("'use client'");
    expect(read(`${UI}/tabs.tsx`)).toContain('tabsTriggerClassName');
    expect(read(`${UI}/tab-styles.ts`)).toContain('aria-[current=page]:border-accent');
  });

  it('Customers and Pipeline are pages of Gild Sales in the sidebar, so neither repeats them as a tab strip', () => {
    // One navigation grain: a sidebar child is a page of a Product, and a ViewNav is for views inside
    // one page. Customers and Pipeline are the former, so the strip that used to say the same thing
    // over the same two routes is gone (Automations' Rules, Messages and Activity likewise).
    const list = read(`${ORG}/customers/page.tsx`);
    const pipeline = read(`${ORG}/customers/pipeline/page.tsx`);
    for (const page of [list, pipeline]) expect(page).not.toMatch(/ViewNav|ViewTabs/);
    expect(() => read(`${WEB}/features/crm/customers/customers-view-nav.tsx`)).toThrow();
    expect(code(list)).not.toMatch(/<Link\b/);
  });

  it('Team renders ViewNav for Members, Invitations and Roles, with nothing but views in it', () => {
    const page = read(`${ORG}/roles/page.tsx`);
    expect(page).toContain('<ViewNav');
    expect(page).not.toContain('TeamViewTabs');
    expect(() => read(`${ORG}/roles/team-view-tabs.tsx`)).toThrow();
    const nav = page.slice(page.indexOf('<ViewNav'), page.indexOf('/>', page.indexOf('views={[')));
    expect(nav).not.toMatch(/Trigger|CreateRoleSheet|<Button/);
  });
});

describe('the page header owns the page’s actions; the toolbar owns search and filter', () => {
  it('Customers: Import, New customer and Configure (last) are header actions, Import a ButtonLink', () => {
    const page = read(`${ORG}/customers/page.tsx`);
    const header = page.slice(page.indexOf('<PageHeader'), page.indexOf('<ConfigureRegistrar'));
    expect(header).toContain('configure={mayConfigure}');
    expect(header.indexOf('<CreateCustomerTrigger />')).toBeLessThan(header.indexOf('configure='));
    expect(header.indexOf('Import')).toBeLessThan(header.indexOf('<CreateCustomerTrigger />'));
    expect(header).toContain('<ButtonLink');
    expect(header).toContain('Import');
    expect(header).toContain('<CreateCustomerTrigger />');
    expect(header).not.toContain('<Link');
  });

  it('the customer toolbar holds no Import and no naked link', () => {
    const toolbar = code(read(`${WEB}/features/crm/customers/customer-list-toolbar.tsx`));
    expect(toolbar).not.toMatch(/Import|mayImport|<Link\b/);
    expect(toolbar).toContain('<ButtonLink');
  });

  it('Team puts the create action for the active view in PageHeader.actions', () => {
    const page = read(`${ORG}/roles/page.tsx`);
    const header = page.slice(page.indexOf('<PageHeader'), page.indexOf('<ViewNav'));
    expect(header).toContain('actions={');
    expect(header).toContain("view === 'roles' ? <CreateRoleSheet organizationId={organizationId} /> : <AddMemberTrigger />");
    expect(page.match(/<CreateRoleSheet/g)).toHaveLength(1);
  });
});

describe('an empty collection explains state; it does not repeat the header’s primary action', () => {
  it('no page whose header already creates the record passes an emptyAction', () => {
    for (const file of [
      'customers/page.tsx',
      'roles/page.tsx',
      'resources/page.tsx',
      'locations/page.tsx',
      'assets/page.tsx',
    ]) {
      expect(read(`${ORG}/${file}`), file).not.toContain('emptyAction');
    }
    for (const table of ['members-table', 'invitations-table', 'roles-table']) {
      expect(read(`${ORG}/roles/${table}.tsx`), table).not.toContain('emptyAction');
    }
  });

  it('the emptyAction API is gone: no caller needed it once each create control was continuously visible', () => {
    // Enforced across the whole application in `residual-polish.test.ts`.
    expect(read(`${WEB}/components/display/table.tsx`)).not.toContain('emptyAction');
  });
});

describe('one table grammar', () => {
  const primitive = read(`${UI}/table.tsx`);
  const display = read(`${WEB}/components/display/table.tsx`);

  it('column headers are scannable: readable size, full-strength text', () => {
    const head = primitive.slice(primitive.indexOf('function TableHead('), primitive.indexOf('function TableCell('));
    expect(head).toContain('text-sm font-medium text-foreground');
    expect(head).not.toMatch(/text-xs|text-muted/);
  });

  it('cells centre on the row so a control and the text beside it share a line — no per-row nudge', () => {
    expect(display).toContain('align-middle');
    expect(display).not.toContain('align-top');
    expect(display).not.toMatch(/translate-y|-mt-/);
  });

  it('rows never shade on hover, and the footer is a static surface, not the text role', () => {
    const row = primitive.slice(primitive.indexOf('function TableRow('), primitive.indexOf('function TableHead('));
    expect(row).not.toContain('hover:');
    expect(primitive).toContain('bg-secondary font-medium');
  });
});

describe('muted is a text role and is never a background', () => {
  it('no source in the workspace or the shared UI uses bg-muted, whatever the opacity or variant', () => {
    const files = [...sources(`${WEB}/app`), ...sources(`${WEB}/components`), ...sources(`${WEB}/features`), ...sources(UI)];
    const offenders = files.filter(({ text }) => /bg-muted(?![-\w])/.test(text)).map(({ path }) => path.slice(WEB.length));
    expect(offenders).toEqual([]);
  });

  it('the Agent question bubble is a static surface', () => {
    // The secondary Bubble is `bg-secondary`; it takes a hover only when its content is a link or a button, and a question is neither.
    const shared = read(`${WEB}/features/agent/agent-shared.tsx`);
    const bubble = read(`${UI}/bubble.tsx`);
    expect(shared).toContain('<Bubble variant="secondary" align="end"');
    expect(bubble).toContain('*:data-[slot=bubble-content]:bg-secondary');
  });
});

describe('Platform Overview follows the shared header geometry', () => {
  it('carries its description in PageHeader rather than a Hint beneath it', () => {
    const overview = read(`${WEB}/features/platform/platform-overview.tsx`);
    expect(overview).toContain('<PageHeader title="Overview" description="The state of every business running on GOLD." />');
    expect(overview).not.toContain('<Hint');
  });
});

describe('the Settings hub', () => {
  const hub = read(`${ORG}/settings/page.tsx`);
  const index = read(`${WEB}/features/settings/settings-index.tsx`);

  it('renders the configuration map through one SettingsIndex, with Setup as its own section rather than a card above it', () => {
    expect(hub).toContain('<SettingsIndex');
    expect(hub).not.toContain('Open setup');
  });

  it('gives each destination one link — its title — and no row of identical Opens', () => {
    const grid = index.slice(index.indexOf('section.entries.map'));
    expect(grid.match(/<Link\b/g)).toHaveLength(1);
    expect(grid).toContain('{entry.title}');
    expect(grid).not.toMatch(/>\s*Open\s*</);
    expect(grid).not.toMatch(/<Button|<input|<select/);
  });
});

describe('Setup owns progress; navigation only navigates', () => {
  const shell = read(`${ORG}/org-shell.tsx`);
  const cockpit = read(`${WEB}/features/setup/setup-cockpit.tsx`);

  it('neither the sidebar row nor the phone bar item prints an x of y count', () => {
    const entries = shell.slice(shell.indexOf('export function SetupEntry'), shell.indexOf('export function OrgSidebar'));
    expect(entries).not.toMatch(/setup\.ready|setup\.total|SidebarMenuBadge| of \$\{/);
    expect(entries).toContain('export function SetupNavLink');
  });

  it('the count stays on the Setup page', () => {
    expect(cockpit).toContain('{overview.ready} of {overview.total}');
  });

  it('area rows say Configure or Open, keep the full target in aria-label, and use no spinner-like icon', () => {
    expect(cockpit).toContain("{area.state === 'complete' ? 'Open' : 'Configure'}");
    expect(cockpit).toContain("aria-label={`${area.state === 'complete' ? 'Open' : 'Configure'} ${area.area.label}`}");
    expect(cockpit).not.toContain('CircleDashed');
  });
});

describe('Badge: tenant statuses are neutral; GOLD-owned facts may carry a tone', () => {
  const spec = read(`${fileURLToPath(new URL('../../../../../docs/ui-spec.md', import.meta.url))}`);
  const badge = read(`${WEB}/components/display/data.tsx`);

  it('the implementation offers success and danger, and Setup Ready uses success', () => {
    expect(badge).toContain("'neutral' | 'accent' | 'success' | 'danger'");
    expect(read(`${WEB}/features/setup/setup-cockpit.tsx`)).toContain("tone: 'success'");
  });

  it('the spec states the rule the code follows', () => {
    expect(spec).toContain('GOLD-owned facts');
    expect(spec).toContain('Tenant-authored statuses stay neutral');
  });
});
