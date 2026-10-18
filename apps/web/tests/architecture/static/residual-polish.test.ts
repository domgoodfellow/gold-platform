import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Durable outcomes of the residual-polish slice. Source guards — nothing mounts a component — on
 * things that would silently regress: a semantic colour spelled as a palette literal, a duplicated
 * create control, dead progress work in the shell, and retired directory language.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const UI = fileURLToPath(new URL('../../../../../packages/ui/src', import.meta.url));
const read = (path: string) => readFileSync(path, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const walk = (dir: string, files: { path: string; text: string }[] = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, files);
    else if (/\.tsx?$/.test(entry.name)) files.push({ path, text: read(path) });
  }
  return files;
};
const app = [...walk(`${WEB}/app`), ...walk(`${WEB}/components`), ...walk(`${WEB}/features`), ...walk(UI)];
// GOLD's own marketing and public site is styled in its own voice; the rule is about the application.
const authenticated = app.filter(({ path }) => !/marketing|\(public\)|public-site/.test(path));

// ---- the success role -------------------------------------------------------------------

const globals = read(`${WEB}/app/globals.css`);

const channel = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [channel(a), channel(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg: string, bg: string, alpha: number) =>
  '#' +
  [1, 3, 5]
    .map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');

describe('success is one central role for GOLD-owned facts', () => {
  const light = /--success:\s*(#[0-9a-f]{6});/i.exec(globals)?.[1];
  const darkBlock = globals.slice(globals.indexOf('prefers-color-scheme: dark'));
  const dark = /--success:\s*(#[0-9a-f]{6});/i.exec(darkBlock)?.[1];

  it('exists once for light and once for dark, and is mapped into the theme', () => {
    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(globals).toContain('--color-success: var(--success);');
  });

  it('the shared Badge consumes it, exactly as it consumes danger', () => {
    const badge = read(`${WEB}/components/display/data.tsx`);
    expect(badge).toContain("'border-success/30 bg-success/10 text-success'");
    expect(badge).toContain("'border-danger/30 bg-danger/10 text-danger'");
  });

  it('keeps text contrast >= 4.5:1 on its own tint, light and dark', () => {
    const lightBg = blend(light!, '#ffffff', 0.1);
    const darkBg = blend(dark!, '#0a0a0a', 0.1);
    expect(contrast(light!, lightBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark!, darkBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('is not a tenant-theme colour: the brand layer writes three roles and never this one', () => {
    const brand = code(read(`${WEB}/features/branding/brand-style.tsx`));
    expect(brand).not.toMatch(/success|danger/);
    expect(brand).toMatch(/--accent/);
  });

  it('no authenticated or shared UI spells a semantic-success green as a palette literal', () => {
    const offenders = authenticated
      .filter(({ text }) => /\b(emerald|green|lime|teal)-\d{2,3}/.test(text))
      .map(({ path }) => path.slice(WEB.length));
    expect(offenders).toEqual([]);
  });

  it('a problem state uses the danger tone rather than painting a neutral badge red', () => {
    const health = read(`${WEB}/features/platform/providers/health-badge.tsx`);
    expect(health).toContain("'danger'");
    expect(health).not.toMatch(/border-danger|text-danger/);
  });
});

describe('a tenant’s own words stay neutral', () => {
  it('no Badge tone is chosen from a tenant-authored name, stage or label', () => {
    const offenders: string[] = [];
    for (const { path, text } of authenticated) {
      for (const match of text.matchAll(/tone=\{([^}\n]*)\}/g)) {
        if (/\.name\b|\bstage\b|stageName|statusName|roleName|\blabel\b/i.test(match[1])) {
          offenders.push(`${path.slice(WEB.length)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a work status and a customer stage render through the neutral treatment', () => {
    const board = read(`${WEB}/features/crm/sales/pipeline-board.tsx`);
    expect(board).not.toMatch(/tone="(success|danger)"/);
    const badge = read(`${WEB}/components/display/data.tsx`);
    expect(badge).toContain("tone = 'neutral'");
  });
});

// ---- empty states -----------------------------------------------------------------------

// An empty state may describe the truth and offer concise next-step guidance (`docs/ui-system.md`
// §8, the UI system) — the earlier blanket ban on any `EmptyState`/`DataTable` action is retired. What
// remains a durable rule is not duplicating a create control a page already shows elsewhere.
describe('an empty state duplicates no create control the page already shows', () => {
  it('the field list in a Configure drawer shows its create control once, beside the count', () => {
    const fields = read(`${WEB}/features/custom-fields/configuration/entity-fields-configuration.tsx`);
    expect(fields.match(/\{create\}/g)).toHaveLength(1);
    expect(fields).toContain('No custom fields for');
    expect(fields).not.toMatch(/No custom fields[^`]*(Add|Create|New)\b/);
  });

  it('Automations rules and messages do not repeat the create control their view already shows', () => {
    expect(read(`${WEB}/features/automations/rules/rules-table.tsx`)).not.toContain('NewAutomationSheet');
    const messages = read(`${WEB}/features/automations/templates/messages-view.tsx`);
    // One create control (no `template`); the other use is a row's own edit sheet.
    expect(messages.match(/<MessageSheet organizationId=\{organizationId\} \/>/g)).toHaveLength(1);
  });
});

// ---- the shell no longer carries Setup progress -------------------------------------------

describe('the shell asks one question — is this business in SETUP — and runs no readiness query', () => {
  const orgLayout = read(`${WEB}/features/shell/organization-shell.tsx`);
  const platformLayout = read(`${WEB}/app/platform/layout.tsx`);
  const shell = read(`${WEB}/app/organizations/[organizationId]/org-shell.tsx`);

  it('neither layout computes the Setup overview', () => {
    expect(code(orgLayout)).not.toContain('computeSetupOverview');
    expect(code(platformLayout)).not.toContain('computeSetupOverview');
  });

  it('both derive it from the lifecycle fact already on the organization', () => {
    expect(orgLayout).not.toContain("const setup = organization.operationalState === 'setup';");
    // Platform Administration is not a business and draws no lifecycle treatment.
    expect(platformLayout).not.toContain('operationalState === ');
  });

  it('the shell components take a boolean, and no count type or prop remains', () => {
    expect(code(shell)).not.toMatch(/SetupProgress|setup\.ready|setup\.total|ready:\s*number/);
    expect(shell).not.toMatch(/setup\?: boolean;/);
    expect(code(shell)).not.toContain('export function SetupEntry');
    expect(code(shell)).not.toContain('export function SetupNavLink');
  });

  it('the Setup page still computes and renders the real progress, and launch stays a domain guard', () => {
    const page = read(`${WEB}/app/organizations/[organizationId]/setup/page.tsx`);
    expect(page).toContain('computeSetupOverview(db, { organizationId }, states)');
    expect(read(`${WEB}/features/setup/guided-setup.tsx`)).toContain('<SetupProgressCard overview={overview} />');
    expect(read(`${WEB}/features/setup/setup-cockpit.tsx`)).toContain('{overview.ready} of {overview.total}');
    expect(read(`${WEB}/lib/domain/tenancy/lifecycle.ts`)).toContain('export async function launchOrganization(');
  });
});

// ---- retired language -------------------------------------------------------------------

describe('no retired organization-directory language in the active UI', () => {
  it('“Your businesses”, “All businesses” and ?all=1 appear in no application source', () => {
    const offenders = authenticated
      .filter(({ text }) => /Your businesses|All businesses|[?&]all=1/.test(text))
      .map(({ path }) => path.slice(WEB.length));
    expect(offenders).toEqual([]);
  });

  it('no application source builds a chooser or a showAll', () => {
    const offenders = authenticated
      .filter(({ path, text }) => !path.includes('/tests/') && /showAll|kind:\s*'chooser'/.test(text))
      .map(({ path }) => path.slice(WEB.length));
    expect(offenders).toEqual([]);
  });
});

