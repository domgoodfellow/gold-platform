import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isProtected, protectedPatterns } from '../../../../../scripts/contract-guard.mjs';

/**
 * Consistency of the documents that define contracts (docs/decisions/README.md → Authority model).
 * These read document text on purpose: they keep the decision record and the canonical documents
 * agreeing with each other. They say nothing about how the application behaves.
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8');
const DECISIONS = 'docs/decisions';
const adrs = readdirSync(`${ROOT}${DECISIONS}`).filter((name) => /^ADR-\d{3}-.+\.md$/.test(name)).sort();
const header = (name: string) => read(`${DECISIONS}/${name}`).split(/\n## /)[0];
const fileOf = (id: string) => adrs.find((name) => name.startsWith(`${id}-`));

describe('the decision record', () => {
  it('lists every ADR in the index', () => {
    const index = read(`${DECISIONS}/README.md`);
    expect(adrs.filter((name) => !index.includes(`(${name})`))).toEqual([]);
  });

  it('gives every ADR a status', () => {
    expect(adrs.filter((name) => !/\*\*Status:\*\*\s*\w/.test(header(name)))).toEqual([]);
  });

  it('links each supersession both ways, and a superseded ADR names an existing successor', () => {
    const problems: string[] = [];
    for (const name of adrs) {
      const id = name.slice(0, 7);
      const text = header(name);
      for (const old of text.match(/\*\*Supersedes:\*\*(.*)/)?.[1].match(/ADR-\d{3}/g) ?? []) {
        const target = fileOf(old);
        if (!target) problems.push(`${id} supersedes missing ${old}`);
        else if (!new RegExp(`\\*\\*Superseded (in part )?by:\\*\\*[^\\n]*${id}`).test(header(target))) problems.push(`${old} does not name ${id} as its successor`);
      }
      if (/\*\*Status:\*\*\s*Superseded/.test(text)) {
        const successor = text.match(/\*\*Superseded by:\*\*[^\n]*?(ADR-\d{3})/)?.[1];
        if (!successor || !fileOf(successor)) problems.push(`${id} is Superseded without an existing successor`);
        else if (!new RegExp(`\\*\\*Supersedes:\\*\\*[^\\n]*${id}`).test(header(fileOf(successor)!))) problems.push(`${successor} does not name ${id} under Supersedes`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the workspace navigation contract (ADR-046)', () => {
  const canonical = ['docs/product.md', 'docs/architecture.md', 'docs/ui-system.md'];

  it('is described once, in product.md, and referenced by the presentation and architecture owners', () => {
    expect(read('docs/product.md')).toMatch(/### Workspace navigation[\s\S]*ADR-046/);
    expect(read('docs/ui-system.md')).toMatch(/## Navigation model\s+[^\n]*docs\/product\.md[^\n]*ADR-046/);
    expect(read('docs/architecture.md')).toMatch(/## Navigation architecture[\s\S]{0,200}docs\/product\.md/);
  });

  it('no canonical document still describes the superseded flat or back-row models', () => {
    // ADR-006's "Home is not repeated as a child" was listed here while ADR-046 made Home an Overview
    // child. ADR-047 (2026-10-19) restored that rule, so the phrase is no longer a superseded model;
    // the retired model is now ADR-046 point 3's Overview child, guarded below.
    const superseded = [/navigation is flat/i, /\bflat (list|sidebar|business|global|organization)\b/i, /\b(stays|remains) flat\b/i, /Back to Workspaces/];
    const found = canonical.flatMap((path) => superseded.filter((pattern) => pattern.test(read(path))).map((pattern) => `${path}: ${pattern}`));
    expect(found).toEqual([]);
  });
});

describe('the explicit workspace Dashboard contract (ADR-049, superseding ADR-047 point 1)', () => {
  it('is stated by product and presentation owners with the explicit approved supersession', () => {
    expect(read('docs/product.md')).toMatch(/### Workspace navigation[\s\S]*?Dashboard is the first explicit destination[^\n]*ADR-049/);
    expect(read('docs/ui-system.md')).toMatch(/## Navigation model[\s\S]*?workspace heading[^\n]*ADR-049/);
  });

  it('no canonical document states the superseded Overview child as the current rule', () => {
    const retired = [/Home appears as \*\*Overview\*\*/, /appears as Overview inside the entered workspace/i];
    const found = ['docs/product.md', 'docs/architecture.md', 'docs/ui-system.md'].flatMap((path) => retired.filter((pattern) => pattern.test(read(path))).map((pattern) => `${path}: ${pattern}`));
    expect(found).toEqual([]);
  });
});

describe('protected contract paths', () => {
  it('cover the agent contract, the decision record, the canonical contract documents and this guard', () => {
    const patterns = protectedPatterns(read('.github/CODEOWNERS'));
    const required = ['AGENTS.md', 'CLAUDE.md','docs/decisions/ADR-046-contextual-workspace-navigation.md', 'docs/product.md', 'docs/architecture.md', 'docs/ui-system.md', 'docs/testing.md', 'scripts/contract-guard.mjs', '.github/workflows/ci.yml', 'test-manifest.json'];
    expect(required.filter((path) => !isProtected(path, patterns))).toEqual([]);
  });

  it('point agents at the authority model and the change protocol', () => {
    // AGENTS.md is the agent contract; CLAUDE.md only imports it for Claude Code.
    expect(read('CLAUDE.md')).toMatch(/^@AGENTS\.md\r?$/m);
    const agents = read('AGENTS.md');
    expect(agents).toContain('docs/decisions/README.md');
    expect(agents).toMatch(/Contract-Change/);
  });
});


describe('approved CRM consolidation governance', () => {
  it('annotates the replaced decision at its historical point without retiring the whole ADR', () => {
    const adr = read(`${DECISIONS}/ADR-047-page-location-and-identity.md`);
    expect(adr).toMatch(/Point 1 superseded effective 2026-10-22 by \[ADR-049\][\s\S]*1\. \*\*Workspace Home/);
    expect(header('ADR-047-page-location-and-identity.md')).toMatch(/Status:\*\* Accepted/);
  });
  it('keeps approved decisions above implementation evidence and one CRM directory', () => {
    expect(read('AGENTS.md')).toContain('Existing code is implementation evidence');
    expect(read('docs/product.md')).toContain('`/crm/contacts/[contactId]`');
    expect(read('docs/product.md')).not.toContain("Dashboard (`/sales`)");
    expect(read('docs/data.md')).toContain('30 consecutive days');
  });
});
