import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The neutral interaction vocabulary (`docs/ui-spec.md` §3): hover, selected, focus-visible,
 * primary, destructive, disabled. Source guards, like `workspace-shell.test.ts` — jsdom computes
 * no styles, so what can be pinned is where the states are written and what they must not use.
 * The rendered values were checked in a browser: neutral hover is the sidebar's own
 * `rgba(0,0,0,0.06)`, pressed is 12%, primary keeps `accent/80`.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const UI = fileURLToPath(new URL('../../../packages/ui/src/components', import.meta.url));

const read = (path: string) => readFileSync(path, 'utf8');
const globals = read(`${WEB}/app/globals.css`);
const button = read(`${UI}/button.tsx`);

const sources = (root: string): { path: string; text: string }[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx$/.test(entry.name) ? [{ path, text: read(path) }] : [];
  });

// Marketing is GOLD's own site, in its own voice; it is not workspace chrome.
const workspace = [...sources(`${WEB}/app`), ...sources(`${WEB}/components`), ...sources(`${WEB}/features`), ...sources(UI)]
  .filter(({ path }) => !/marketing|public-site/.test(path));

const variant = (name: string) => button.slice(button.indexOf(`${name}:`), button.indexOf('\n', button.indexOf(`${name}:`) + 20) + 200);

describe('neutral hover and selected are two roles derived from what already worked', () => {
  it('hover is the sidebar tint itself, not a second value', () => {
    expect(globals).toContain('--hover: var(--sidebar-accent);');
    expect(globals).toContain('--color-hover: var(--hover);');
  });

  it('selected is stronger than hover and derived from the foreground, so it needs no dark override', () => {
    expect(globals).toMatch(/--selected: color-mix\(in srgb, var\(--foreground\) 12%, transparent\);/);
    expect(globals).toContain('--color-selected: var(--selected);');
  });
});

describe('the shared variants own the states; a screen writes none', () => {
  it('neutral Button variants hover to `hover` and rest pressed/open on `selected`', () => {
    for (const name of ['outline', 'ghost']) {
      const block = variant(name);
      expect(block, `${name} hover`).toContain('hover:bg-hover');
      expect(block, `${name} selected`).toContain('aria-expanded:bg-selected');
      expect(block, `${name} pressed`).toContain('aria-pressed:bg-selected');
    }
  });

  it('primary keeps its own hover and never takes the neutral one', () => {
    const primary = button.slice(button.indexOf('default: "'), button.indexOf('\n', button.indexOf('default: "')));
    expect(primary).toContain('hover:bg-accent/80');
    expect(primary).not.toContain('hover:bg-hover');
  });

  it('Agent and Configure show pressed through aria-pressed on the variant, not a class of their own', () => {
    const rail = read(`${WEB}/components/containers/workspace-right-rail.tsx`);
    expect(rail).toContain('aria-pressed={agentOpen}');
    expect(rail).toContain('aria-pressed={configureOpen}');
    expect(rail).not.toMatch(/&& 'bg-/);
  });

  it('a table row does not shade merely for being a row', () => {
    const table = read(`${UI}/table.tsx`);
    const row = table.slice(table.indexOf('function TableRow('), table.indexOf('function TableHead('));
    expect(row).not.toContain('hover:');
    expect(row).toContain('data-[state=selected]:bg-selected');
  });

  it('menu items highlight neutrally, not in the accent (which is the primary button)', () => {
    const menu = read(`${UI}/dropdown-menu.tsx`);
    expect(menu).not.toMatch(/focus:bg-accent|data-open:bg-accent/);
    expect(menu).toContain('focus:bg-hover');
  });
});

describe('nothing in the workspace re-spells a neutral state', () => {
  it('uses none of the spellings that read as a heavy gray block or a second tint', () => {
    // `bg-muted` is the 70% text role; `black/5` and `white/10` were the sidebar's tint typed out.
    const banned = /hover:bg-muted|aria-expanded:bg-muted|data-\[state=selected\]:bg-muted|focus:bg-accent|hover:bg-black\/|hover:bg-white\/|dark:hover:bg-(?:white|black|input|muted)/;
    const offenders = workspace.filter(({ text }) => banned.test(text)).map(({ path }) => path.slice(WEB.length));
    expect(offenders).toEqual([]);
  });

  it('no `group-hover` shades a container because a child is hovered', () => {
    const offenders = workspace.filter(({ text }) => /group-hover:bg-/.test(text)).map(({ path }) => path.slice(WEB.length));
    expect(offenders).toEqual([]);
  });
});
