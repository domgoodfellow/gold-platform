import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PublicHomepageSectionsSchema } from '@gold/schemas';

const complete = [
  { kind: 'hero', eyebrow: 'A', heading: 'B', body: 'C', primaryCta: { label: 'Go', href: '/go' }, secondaryCta: { label: 'Read', href: '#read' } },
  { kind: 'problem', heading: 'Problem', paragraphs: ['One'] },
  { kind: 'capabilities', eyebrow: 'Can', heading: 'Capabilities', body: 'Body', items: [{ title: 'One', body: 'Body' }] },
  { kind: 'process', eyebrow: 'How', heading: 'Process', items: [{ step: '01', title: 'One', body: 'Body' }] },
  { kind: 'trust', eyebrow: 'Trust', heading: 'Trust', items: [{ title: 'One', body: 'Body' }] },
  { kind: 'cta', heading: 'Act', body: 'Body', primaryCta: { label: 'Go', href: '/go' }, secondaryCta: { label: 'More', href: '/more' } },
];

describe('public homepage section vocabulary', () => {
  it('accepts the complete fixed vocabulary', () => {
    expect(PublicHomepageSectionsSchema.parse(complete)).toHaveLength(6);
  });

  it('refuses duplicate kinds, arbitrary component names and external links', () => {
    expect(PublicHomepageSectionsSchema.safeParse([...complete.slice(0, 5), complete[0]]).success).toBe(false);
    expect(PublicHomepageSectionsSchema.safeParse([...complete.slice(0, 5), { kind: 'html', heading: '<script>' }]).success).toBe(false);
    expect(PublicHomepageSectionsSchema.safeParse(complete.map((section) => section.kind === 'cta' ? { ...section, primaryCta: { label: 'Leave', href: 'https://example.test' } } : section)).success).toBe(false);
    expect(PublicHomepageSectionsSchema.safeParse(complete.map((section) => section.kind === 'problem' ? { kind: 'problem', paragraphs: ['Missing heading'] } : section)).success).toBe(false);
  });

  it('invalidates anonymous output only from publish and keeps previews protected', () => {
    const actions = readFileSync(fileURLToPath(new URL('../app/organizations/[organizationId]/settings/website/actions.ts', import.meta.url)), 'utf8');
    const access = readFileSync(fileURLToPath(new URL('../lib/route/access.ts', import.meta.url)), 'utf8');
    const previewLayout = readFileSync(fileURLToPath(new URL('../app/(preview)/layout.tsx', import.meta.url)), 'utf8');
    expect(actions.match(/updateTag\(GOLD_HOMEPAGE_CACHE_TAG\)/g)).toHaveLength(1);
    expect(actions.indexOf('updateTag(GOLD_HOMEPAGE_CACHE_TAG)')).toBeGreaterThan(actions.indexOf('publishRevisionAction'));
    expect(access).not.toContain("'/preview/'");
    expect(previewLayout).toContain('index: false');
  });

  it('never lets the homepage prerender at build time against a database migrations have not reached yet', () => {
    const page = readFileSync(fileURLToPath(new URL('../app/(marketing)/page.tsx', import.meta.url)), 'utf8');
    expect(page).toContain("export const dynamic = 'force-dynamic'");
  });
});
