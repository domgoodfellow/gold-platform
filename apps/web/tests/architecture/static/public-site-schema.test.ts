import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESERVED_PAGE_SLUGS, SECTION_KINDS } from '@gold/schemas';
import { SECTION_REGISTRY } from '@/lib/domain/public-site/section-registry';
import { SECTION_RENDERERS } from '@/features/public-site/section-renderers';
import { SECTION_EDITORS } from '@/features/studio/website/section-editors';
import { AREAS } from '@/lib/navigation';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(root, dir))) {
    const full = path.join(dir, entry);
    if (statSync(path.join(root, full)).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the website vocabulary has one definition per kind', () => {
  it('registers, renders and edits exactly the kinds the schema has', () => {
    const kinds = [...SECTION_KINDS].sort();
    expect(Object.keys(SECTION_REGISTRY).sort()).toEqual(kinds);
    expect(Object.keys(SECTION_RENDERERS).sort()).toEqual(kinds);
    expect(Object.keys(SECTION_EDITORS).sort()).toEqual(kinds);
  });

  it('is judged by the database for every kind the schema has', () => {
    const migration = read('../../supabase/migrations/20261022000052_a_website_is_one_revision_of_pages_and_sections.sql');
    for (const kind of SECTION_KINDS) expect(migration).toContain(`v_kind = '${kind}'`);
  });

  it('reserves the same paths in TypeScript and in the database', () => {
    const migration = read('../../supabase/migrations/20261022000052_a_website_is_one_revision_of_pages_and_sections.sql');
    const list = /select array\[([^\]]+)\]::text\[\]/.exec(migration.slice(migration.indexOf('public_site_reserved_slugs')))![1]!;
    const sql = list.split(',').map((item) => item.trim().replace(/'/g, ''));
    expect(sql.sort()).toEqual([...RESERVED_PAGE_SLUGS].sort());
  });
});

describe('the website has no escape hatch', () => {
  it('draws text, never markup, in the renderers and the editors', () => {
    for (const file of ['features/public-site/section-renderers.tsx', 'features/public-site/site-view.tsx', 'features/public-site/form-section.tsx', 'features/studio/website/section-editors.tsx']) {
      expect(read(file), file).not.toContain('dangerouslySetInnerHTML');
    }
  });

  it('stores no markup, script or component field in the schema', () => {
    const schema = read('../../packages/schemas/src/website.ts');
    for (const field of ['html:', 'script:', 'component:', 'jsx:', 'iframe']) expect(schema).not.toContain(field);
  });
});

describe('Studio Canvas and the public site share one renderer', () => {
  it('draws sections only through SectionView, never its own copy', () => {
    const canvas = read('features/studio/website/website-canvas.tsx');
    expect(canvas).toContain("from '@/features/public-site/section-renderers'");
    expect(canvas).toContain('<SectionView');
    for (const file of sourceFiles('features/studio')) {
      if (file.includes('section-editors') || file.includes('template')) continue;
      expect(read(file), file).not.toMatch(/<(section|h1)\b[^>]*className="[^"]*(rounded-2xl bg-secondary|lg:grid-cols-\[1fr_460px\])/);
    }
  });

  it('keeps the public site free of Studio, and the website free of providers', () => {
    for (const file of [...sourceFiles('features/public-site'), ...sourceFiles('lib/domain/public-site')]) {
      expect(read(file), file).not.toMatch(/from ['"]@\/features\/studio/);
    }
    for (const file of [...sourceFiles('features/studio/website'), ...sourceFiles('lib/domain/public-site')]) {
      expect(read(file), file).not.toMatch(/vercel|cloudflare|adapters\/(domains|hosting)/i);
    }
  });

  it('references a form by id and never copies its fields into the website', () => {
    const renderer = read('features/public-site/form-section.tsx');
    expect(renderer).toContain('context.forms[formId]');
    expect(read('../../packages/schemas/src/website.ts')).not.toMatch(/formId[\s\S]{0,80}fields/);
  });
});

describe('Studio keeps one workspace with its own pages', () => {
  it('still has Website, Forms and Templates in its sidebar, and no workspace of their own', () => {
    for (const segment of ['studio-website', 'studio-forms', 'studio-templates']) {
      const area = AREAS.find((entry) => entry.segment === segment);
      expect(area, segment).toBeDefined();
      expect(area!.workspace).toBe('studio');
      expect(area!.sidebar).not.toBe(false);
    }
    expect(AREAS.some((area) => ['website', 'forms', 'templates'].includes(area.segment))).toBe(false);
  });
});

describe('publication', () => {
  it('invalidates anonymous output only from publish and keeps previews protected', () => {
    const actions = read('app/organizations/[organizationId]/studio/website/actions.ts');
    const access = read('lib/route/access.ts');
    const previewLayout = read('app/(preview)/layout.tsx');
    expect(actions.match(/updateTag\(GOLD_HOMEPAGE_CACHE_TAG\)/g)).toHaveLength(1);
    expect(actions.indexOf('updateTag(GOLD_HOMEPAGE_CACHE_TAG)')).toBeGreaterThan(actions.indexOf('publishRevisionAction'));
    expect(access).not.toContain("'/preview/'");
    expect(previewLayout).toContain('index: false');
  });

  it('selects one revision by one pointer, never page by page', () => {
    const migration = read('../../supabase/migrations/20261022000052_a_website_is_one_revision_of_pages_and_sections.sql');
    expect(migration).toContain('current_published_revision_id');
    expect(migration).not.toMatch(/create table public\.public_pages/);
  });

  it('never lets the homepage prerender at build time against a database migrations have not reached yet', () => {
    expect(read('app/(marketing)/page.tsx')).toContain("export const dynamic = 'force-dynamic'");
    expect(read('app/(public)/sites/[hostname]/page.tsx')).toContain("export const dynamic = 'force-dynamic'");
    expect(read('app/(public)/sites/[hostname]/[slug]/page.tsx')).toContain("export const dynamic = 'force-dynamic'");
  });

  it('answers a path no page owns with the neutral public 404, resolving the hostname itself', () => {
    const hosted = read('features/public-site/hosted-page.tsx');
    expect(hosted).toContain('notFound()');
    expect(hosted).toContain('publishedHostnameSite(');
    expect(read('proxy.ts')).toContain('isServablePageSlug(segment)');
  });
});
