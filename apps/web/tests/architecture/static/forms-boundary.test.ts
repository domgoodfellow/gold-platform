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
  // Booking owns the booking (service, slot, resources, price, status); Forms owns configurable
  // questions. A booking may *ask* a form, so the dependency runs one way and through one seam.
  it('forms never reach into booking', () => {
    for (const file of FORMS_FILES) expect(read(file), file).not.toMatch(/domain\/booking|book\/\[slug\]|booking-form/);
  });

  it('booking names a form in exactly one domain file, and only to read the list', () => {
    for (const file of filesUnder('lib/domain/booking').filter((path) => !path.endsWith('/intake.ts'))) {
      expect(read(file), file).not.toMatch(/domain\/forms|features\/forms|@gold\/schemas.*Form/);
    }
    const seam = read('lib/domain/booking/intake.ts');
    expect(seam).toContain("import { listForms } from '@/lib/domain/forms/forms'");
    expect(seam).not.toMatch(/record_form_submission|form_submissions|submit_public_form|submitPublicForm/);
  });

  it('the booking page draws the business\'s questions with the one field renderer, never Studio\'s UI', () => {
    const page = read('app/(public)/book/[slug]/booking-form.tsx');
    expect(page).toContain("@/features/forms/form-renderer");
    for (const file of filesUnder('app/(public)/book')) expect(read(file), file).not.toMatch(/features\/studio|studio\/forms/);
    expect(read('lib/domain/booking/booking.ts')).not.toMatch(/features\/studio/);
  });

  it('writes the answers inside create_booking, never by a second call', () => {
    const booking = read('lib/domain/booking/booking.ts');
    expect(booking).toContain('p_intake_revision_id');
    expect(booking).not.toMatch(/submit_public_form|submitPublicForm|submit_portal_form/);
    // And the form to ask is never named by the browser: the action reads it from the type.
    const action = read('app/(public)/book/[slug]/actions.ts');
    expect(action).not.toMatch(/formData\.get\('formId'\)|p_form_id/);
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

  it('reads and writes only through the anonymous doors, and writes through exactly one', () => {
    const source = read('lib/domain/forms/public-forms.ts');
    expect([...source.matchAll(/\.rpc\('([a-z_]+)'/g)].map((match) => match[1]).sort()).toEqual(['published_form', 'published_form_by_key', 'published_hostname_form', 'submit_public_form_by_key']);
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
      expect(read(file), file).not.toMatch(/createCustomer|\.from\('customers'\)|sendMessage|create_booking|automation/);
    }
  });
});

describe('every Studio forms action checks the caller before doing anything', () => {
  it('calls requireOrganization first in each exported action', () => {
    const source = read('app/organizations/[organizationId]/studio/forms/actions.ts');
    const actions = source.split(/export async function /).slice(1);
    expect(actions.length).toBeGreaterThanOrEqual(9);
    for (const action of actions) {
      // The body starts after the line that closes the signature: `}): Promise<...> {`.
      const signatureEnd = /\): Promise<[^\n]*> \{\r?\n/.exec(action);
      const body = action.slice((signatureEnd?.index ?? 0) + (signatureEnd?.[0].length ?? 0));
      expect(body.trimStart().startsWith('await requireOrganization('), action.split('(')[0]).toBe(true);
    }
  });
});

describe('a form is placed, not copied', () => {
  it('lets a website section name a form by id and nothing of its fields', () => {
    const schema = readFileSync(`${WEB}/../../packages/schemas/src/index.ts`, 'utf8');
    const section = schema.slice(schema.indexOf("kind: z.literal('form')"), schema.indexOf("kind: z.literal('hero')"));
    expect(section).toContain('formId');
    expect(section).not.toMatch(/definition|fields|options/);
  });

  it('draws every placement through the one renderer', () => {
    expect(read('features/public-site/form-section.tsx')).toMatch(/KeyedPublicForm|FormPreview/);
    expect(read('features/forms/keyed-public-form.tsx')).toContain("./public-form");
    expect(read('features/forms/form-preview.tsx')).toContain("./form-renderer");
    expect(read('features/portal-access/portal-forms.tsx')).toContain("@/features/forms/public-form");
    expect(read('app/(embed)/embed/forms/[publicKey]/page.tsx')).toContain('KeyedPublicForm');
  });

  it('keeps each owner\'s reference in its own domain: Forms imports none of the surfaces that place it', () => {
    for (const file of filesUnder('lib/domain/forms')) {
      expect(read(file), file).not.toMatch(/domain\/(portal|public-site|booking|customers)\//);
    }
  });

  it('has no placement table that points at several owners', () => {
    const migration = read('../../supabase/migrations/20261115000001_a_form_is_placed_not_copied.sql');
    expect(migration).not.toMatch(/create table public\.form_placements/);
    expect(migration).toContain('create table public.portal_forms');
  });

  it('lets a portal response name a customer only through the caller\'s own binding', () => {
    const source = read('lib/domain/portal/portal-forms.ts');
    expect(source).not.toMatch(/customerId|customer_id/);
  });

  it('serves the embed to other sites and nothing else, and frames nothing else', () => {
    const config = read('next.config.ts');
    expect(config).toContain('"/embed/:path*"');
    expect(config).toContain('frame-ancestors *');
    expect(config).toContain("frame-ancestors 'self'");
    const embed = read('app/(embed)/embed/forms/[publicKey]/page.tsx');
    expect(embed).not.toMatch(/organizationId|requireOrganization|studio/);
  });
});

describe('a public write ends only the session it began', () => {
  it('signs out nowhere but the helpers and the sign-out screen', () => {
    const offenders: string[] = [];
    for (const file of [...filesUnder('lib/domain'), ...filesUnder('features'), ...filesUnder('app')]) {
      if (/auth\.signOut\(/.test(read(file))) offenders.push(file);
    }
    // The portal's exchange is the second helper. It ends a session only on a client that holds
    // the portal's own cookie (below), so it can never end a Studio or a booking visitor's.
    // The proposal's exchange is the third, on the same terms, in the proposal's own cookie.
    expect(offenders.sort()).toEqual(['lib/domain/customers/proposal-access.ts', 'lib/domain/identity/anonymous-session.ts', 'lib/domain/identity/credentials.ts', 'lib/domain/portal/portal.ts']);
  });

  it('keeps the portal session in a cookie of its own, so it can neither replace nor end another', () => {
    const portal = read('lib/db/portal.ts');
    expect(portal).toContain("PORTAL_COOKIE_NAME = 'gold-portal'");
    expect(portal).toContain('cookieOptions: { name: PORTAL_COOKIE_NAME }');
    expect(portal).toMatch(/httpOnly: true/);
    // The only code that exchanges a link builds that client itself, and ends sessions locally only.
    expect(read('app/(public)/portal/[token]/route.ts')).toContain('createPortalClient');
    expect(read('lib/domain/portal/portal.ts')).toMatch(/signOut\(\{ scope: 'local' \}\)/);
    // The account session's client never learns the portal's cookie.
    expect(read('lib/db/server.ts')).not.toMatch(/gold-portal|PORTAL_COOKIE/);
  });
});
