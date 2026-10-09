import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');
describe('Global Home architecture', () => {
  it('keeps one landing implementation and read projections outside the route and client', () => {
    expect(existsSync(`${WEB}/app/organizations/[organizationId]/today`)).toBe(false);
    const page = read('app/organizations/[organizationId]/home/page.tsx');
    expect(page).toContain('requireOrganization');
    expect(page).toContain('loadHome');
    expect(page).not.toMatch(/\.from\(|\.rpc\(/);
    expect(read('features/home/home-dashboard.tsx')).not.toMatch(/\.from\(|\.rpc\(|createClient|getDb/);
  });
  it('uses the ordinary actor client, canonical availability and existing global Agent rail', () => {
    const load = read('lib/application/home/load.ts');
    expect(load).toContain('areaAvailable');
    expect(load).toContain("capabilities.has('report.read')");
    expect(load).not.toMatch(/SERVICE_ROLE|serviceRole|createClient/);
    expect(read('features/home/home-dashboard.tsx')).toContain('useWorkspaceRail');
    expect(read('lib/application/home/reads.ts')).not.toContain('home_tasks');
  });
});
