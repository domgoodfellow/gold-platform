import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isExcluded, scan, scanSource } from '../../../../../scripts/check-ui-copy.mjs';

/**
 * The UI copy check (AGENTS.md → UI rules; docs/ui-system.md → Core rules). It is a content-discipline
 * gate approved by the UI copy discipline work order, not a style preference: an operator screen does
 * not print an eyebrow above a heading, a subtitle that restates or describes it, or an info icon on
 * every row. The script owns the heuristics; this file runs it over the repository and pins what it
 * recognizes, so a change to the heuristics shows up here.
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const rules = (source: string, file = 'apps/web/features/example/view.tsx') => scanSource(source, file).map((f: { rule: string }) => f.rule);

describe('operator surfaces in the repository', () => {
  it('have no eyebrow, default subtitle, card description or per-row info icon', () => {
    const findings = scan(ROOT).map((f: { file: string; line: number; rule: string; detail: string }) => `${f.file}:${f.line} ${f.rule} ${f.detail}`);
    expect(findings).toEqual([]);
  });
});

describe('what the check flags', () => {
  it('an uppercase, letter-spaced label right above a heading', () => {
    expect(rules('<div><p className="text-xs uppercase tracking-wide">Contact</p><h1>Send us a message</h1></div>')).toEqual(['eyebrow']);
  });

  it('a muted sentence under a heading when content follows', () => {
    expect(rules('<Section><SectionHeading>Stages</SectionHeading><Hint>Name the stages your customers move through.</Hint><List /></Section>')).toEqual(['subtitle']);
  });

  it('a muted sentence after a heading row that holds the heading and its action', () => {
    expect(rules('<section><div className="flex"><h2>Queues</h2><Button>New</Button></div><p className="text-sm text-muted">Queues group cases by who is responsible.</p><List /></section>')).toEqual(['subtitle']);
  });

  it('a muted sentence first inside a titled panel, even when it is all the panel holds', () => {
    expect(rules('<OperationalPanel title="Insights"><p className="text-xs text-muted">Operator metrics are personal and stay in this workspace.</p></OperationalPanel>')).toEqual(['subtitle']);
  });

  it('every CardDescription', () => {
    expect(rules('<Card><CardHeader><CardDescription>Staff only</CardDescription><CardTitle>Bootstrap</CardTitle></CardHeader></Card>')).toEqual(['card-description']);
  });

  it('a sentence-long description on a NavigationList item', () => {
    expect(rules("<NavigationList items={[{ key: 'a', title: 'Files', description: 'Everything this business has uploaded so far' }]} />")).toEqual(['nav-description']);
  });

  it('an info icon drawn once per row', () => {
    expect(rules('<ul>{rows.map((row) => (<li key={row.id}>{row.name}<Info className="size-4" /></li>))}</ul>')).toEqual(['info-icon']);
    expect(rules('<ul>{rows.map((row) => (<li key={row.id}>{row.name}<InfoPopover label="About">x</InfoPopover></li>))}</ul>')).toEqual(['info-icon']);
  });
});

describe('what the check keeps, by structure', () => {
  it('a group label over list items', () => {
    expect(rules('<div><GroupHeading>Link</GroupHeading><DividedList>{items}</DividedList></div>')).toEqual([]);
  });

  it('status and alert messages', () => {
    expect(rules('<Section><SectionHeading>Sync</SectionHeading><Hint role="status">The last sync failed and will retry in a few minutes.</Hint><List /></Section>')).toEqual([]);
  });

  it('a permission blocker', () => {
    expect(rules('<Section><SectionHeading>Forms</SectionHeading><Hint>{`Your role, ${role}, cannot manage forms.`}</Hint><List /></Section>')).toEqual([]);
  });

  it('short factual metadata', () => {
    expect(rules('<div><h2>{type.name}</h2><p className="text-sm text-muted">{scheduled} · {stages} stages</p><Tabs /></div>')).toEqual([]);
  });

  it('an empty state that says what the section is for', () => {
    expect(rules('<section><h2>No contacts yet</h2><p className="text-sm text-muted">Add a person or company to start your relationships here.</p><Actions /></section>')).toEqual([]);
  });

  it('a sentence that is the whole section, such as a blocker', () => {
    expect(rules('<Section><SectionHeading>Needs classification</SectionHeading><p className="text-sm text-muted">Edit this contact to classify it before managing affiliations.</p></Section>')).toEqual([]);
  });

  it('a line marked with a reason', () => {
    expect(rules('<Section><SectionHeading>Booking</SectionHeading>\n{/* ui-copy-allow: the spec requires this statement */}\n<Hint>These limits apply only to customers booking online.</Hint><Form /></Section>')).toEqual([]);
  });

  it('public surfaces, which follow docs/public-web.md', () => {
    for (const file of ['apps/web/app/(marketing)/pricing/page.tsx', 'apps/web/app/(public)/book/[slug]/page.tsx', 'apps/web/app/(auth)/login/page.tsx', 'apps/web/features/public-site/section-renderers.tsx', 'apps/web/components/marketing/product-card.tsx', 'apps/web/features/portal-access/portal-page.tsx', 'apps/web/features/studio/portal/portal-renderer.tsx']) {
      expect(isExcluded(file), file).toBe(true);
    }
    expect(isExcluded('apps/web/features/crm/customers/customer-detail.tsx')).toBe(false);
  });
});
