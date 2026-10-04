import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Forms are a domain of their own, and four separations are what keep them one: the form is not
 * the booking, the preview is not a second renderer, the public address does not take an id, and
 * authoring does not reach into the infrastructure that serves a hostname. Source scans prove the
 * rule, not the screen — the browser journey proves the screen.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(`${WEB}/${dir}`, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const FORMS_FILES = [
  ...filesUnder('lib/domain/forms'),
  ...filesUnder('features/forms'),
  ...filesUnder('features/studio/forms'),
  ...filesUnder('app/(public)/forms'),
  ...filesUnder('app/organizations/[organizationId]/studio/forms'),
  ...filesUnder('app/organizations/[organizationId]/studio/templates'),
];

describe('forms are not booking', () => {
  it('shares no module with booking in either direction', () => {
    for (const file of FORMS_FILES) expect(read(file), file).not.toMatch(/domain\/booking|book\/\[slug\]|booking-form/);
    for (const file of [...filesUnder('lib/domain/booking'), 'app/(public)/book/[slug]/booking-form.tsx']) {
      expect(read(file), file).not.toMatch(/domain\/forms|features\/forms|@gold\/schemas.*Form/);
    }
  });
});

describe('one renderer', () => {
  it('is what both the Studio builder and the hosted form draw fields with', () => {
    expect(read('features/studio/forms/form-builder.tsx')).toContain("@/features/forms/form-renderer");
    expect(read('features/forms/public-form.tsx')).toContain("./form-renderer");
    expect(read('features/studio/forms/template-list.tsx')).toContain("@/features/forms/form-renderer");
  });

  it('is the only file that turns a field type into a control', () => {
    for (const file of FORMS_FILES.filter((path) => path.endsWith('.tsx') && !path.endsWith('form-renderer.tsx'))) {
      expect(read(file), file).not.toMatch(/case 'long_text'|type="radio"|<SelectInput|<NativeSelect/);
    }
  });
});

describe('the public address names the form; a caller never supplies an id', () => {
  it('has a public route resolved by slug, and no organization id anywhere on it', () => {
    for (const file of filesUnder('app/(public)/forms')) {
      expect(read(file), file).not.toMatch(/organizationId|organization_id|p_organization_id/);
    }
    expect(existsSync(`${WEB}/app/(public)/forms/[organizationSlug]/[formSlug]/page.tsx`)).toBe(true);
  });

  it('reads and writes only through the two anonymous doors', () => {
    const source = read('lib/domain/forms/public-forms.ts');
    expect([...source.matchAll(/\.rpc\('([a-z_]+)'/g)].map((match) => match[1]).sort()).toEqual(['published_form', 'submit_public_form']);
    expect(source).not.toMatch(/\.from\(/);
  });

  it('is a public path in the closed set, by prefix', () => {
    expect(read('lib/route/access.ts')).toContain("'/forms/'");
  });
});

describe('authoring does not reach into infrastructure', () => {
  it('names no DNS, certificate, hostname-provider or provider-credential concern', () => {
    for (const file of FORMS_FILES) {
      expect(read(file), file).not.toMatch(/cloudflare|vercel|dns|certificate|provider_account|provider_operator|service[_-]role/i);
    }
  });
});

describe('a form does not decide what happens after it is submitted', () => {
  it('writes no customer, message or booking when a submission lands', () => {
    for (const file of filesUnder('lib/domain/forms')) {
      expect(read(file), file).not.toMatch(/customers|createCustomer|sendMessage|create_booking|automation/);
    }
  });
});

describe('every Studio forms action checks the caller before doing anything', () => {
  it('calls requireOrganization first in each exported action', () => {
    const source = read('app/organizations/[organizationId]/studio/forms/actions.ts');
    const actions = source.split(/export async function /).slice(1);
    expect(actions.length).toBeGreaterThanOrEqual(6);
    for (const action of actions) {
      const body = action.slice(action.indexOf('Promise<FormActionResult> {') + 'Promise<FormActionResult> {'.length);
      expect(body.trimStart().startsWith('await requireOrganization('), action.split('(')[0]).toBe(true);
    }
  });
});
