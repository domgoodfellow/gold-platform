import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getBrand, setBrand, DEFAULT_BRAND } from '@/lib/domain/branding/brand';
import {
  AA_TEXT,
  PAGE_DARK,
  PAGE_LIGHT,
  brandPalette,
  contrastRatio,
  foregroundOn,
  normaliseBrandColour,
  readableOn,
} from '@/lib/domain/branding/palette';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A business looks like itself, and cannot make its own screens unreadable.
 *
 * **The second half is the one worth testing.** That a colour is stored and rendered is
 * ordinary; that *any* colour a business picks stays legible is the guarantee the UI system's refusal was
 * really about, and it is arithmetic — so it is asserted over a spread of colours rather than
 * over the one somebody had in mind while writing it.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Business = { db: SupabaseClient; organizationId: string; email: string };

async function newBusiness(label: string): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = anonClient();
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    currency: 'EUR',
  });

  return { db, organizationId, email };
}

/** A spread wide enough to include the cases that break a naive derivation. */
const COLOURS = [
  '#000000', // black
  '#ffffff', // white — the one that is invisible as a link on a light page
  '#ffff00', // pure yellow — the classic failure
  '#1f6feb', // an ordinary blue
  '#dc2626', // a red close to the platform's own danger role
  '#0a0a0a', // all but identical to the dark page background
  '#7f7f7f', // the mid grey where black and white are nearly equally bad
  '#00ff00',
  '#4b0082',
  '#ff6b00',
];

describe('the palette', () => {
  it('always produces a legible label on a button, whatever colour is chosen', () => {
    for (const colour of COLOURS) {
      const ratio = contrastRatio(colour, foregroundOn(colour));
      // **The floor here is arithmetic rather than luck.** The worst possible background is the
      // one where black and white are equally bad, and there the better of the two is still
      // 4.58:1 — so a business may pick any colour at all for a button and the label on it is
      // always readable, with no adjustment to the colour they chose.
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('always produces a legible link, in both schemes', () => {
    for (const colour of COLOURS) {
      for (const page of [PAGE_LIGHT, PAGE_DARK]) {
        expect(contrastRatio(readableOn(colour, page), page)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('leaves a colour alone when it already reads', () => {
    // Untouched is the honest answer when nothing needs fixing: a business that picked a colour
    // that works should see exactly that colour, not a shade the platform preferred.
    expect(readableOn('#1f6feb', PAGE_LIGHT)).toBe('#1f6feb');
    expect(readableOn('#ffff00', PAGE_DARK)).toBe('#ffff00');
  });

  it('moves lightness and not hue', () => {
    // A business that picked a particular orange is still that orange as a link — darker, and
    // recognisably theirs. Changing the hue to reach the threshold would be the platform
    // choosing a different colour and not saying so.
    const adjusted = readableOn('#ff6b00', PAGE_LIGHT);
    expect(adjusted).not.toBe('#ff6b00');

    const [r, g, b] = [1, 3, 5].map((at) => parseInt(adjusted.slice(at, at + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('reads a colour the way a person writes one, and refuses what is not one', () => {
    expect(normaliseBrandColour('#1F6FEB')).toBe('#1f6feb');
    expect(normaliseBrandColour('  #0af ')).toBe('#00aaff');
    // A named colour is refused rather than resolved: accepting it would mean the column holds
    // two spellings of one answer.
    expect(normaliseBrandColour('rebeccapurple')).toBeNull();
    expect(normaliseBrandColour('#12345')).toBeNull();
    expect(normaliseBrandColour('')).toBeNull();
  });

  it('derives against the page colours the stylesheet actually uses', () => {
    // **The one thing in this module that could rot silently.** `palette.ts` cannot read a
    // stylesheet, so it repeats `globals.css`'s two page colours — and a comment saying "keep
    // these in step" is a weaker link than a test that fails when they are not.
    const css = readFileSync(new URL('../../../app/globals.css', import.meta.url), 'utf8');
    const light = /:root\s*(?:,\s*\[data-public-design\])?\s*\{[^}]*?--background:\s*(#[0-9a-f]{6})/i.exec(css);
    const dark = /prefers-color-scheme:\s*dark[^{]*\{\s*:root\s*(?:,\s*\[data-public-design\])?\s*\{[^}]*?--background:\s*(#[0-9a-f]{6})/i.exec(css);

    expect(light?.[1].toLowerCase()).toBe(PAGE_LIGHT);
    expect(dark?.[1].toLowerCase()).toBe(PAGE_DARK);
    const scopedDark = /\[data-appearance="dark"\]\s*\{[^}]*?--background:\s*(#[0-9a-f]{6})/i.exec(css);
    const scopedLight = /\[data-appearance="light"\]\s*\{[^}]*?--background:\s*(#[0-9a-f]{6})/i.exec(css);
    expect(scopedDark?.[1].toLowerCase()).toBe(PAGE_DARK);
    expect(scopedLight?.[1].toLowerCase()).toBe(PAGE_LIGHT);
  });

  it('hands the renderer a font stack rather than a key', () => {
    const palette = brandPalette({ accent: '#1f6feb', headingFont: 'serif', bodyFont: 'sans' });
    expect(palette.headingFont).toContain('Georgia');
    expect(palette.bodyFont).toContain('--font-geist-sans');
  });
});

describe('what a business chose', () => {
  let shop: Business;

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    shop = await newBusiness('brand');
  });

  it('starts with nothing, and nothing is not a colour', async () => {
    // **An absent row means *has said nothing*.** Writing defaults in at founding would make a
    // business that never opened the screen indistinguishable from one that chose the
    // platform's own look on purpose.
    expect(await getBrand(shop.db, { organizationId: shop.organizationId })).toEqual(
      DEFAULT_BRAND,
    );
  });

  it('keeps what it was given, and clears back to nothing', async () => {
    await setBrand(shop.db, {
      organizationId: shop.organizationId,
      accent: '#1F6FEB',
      headingFont: 'serif',
      bodyFont: 'sans',
    });

    const saved = await getBrand(shop.db, { organizationId: shop.organizationId });
    // Lowercased on the way in, so there is one spelling of one answer in the column.
    expect(saved.accent).toBe('#1f6feb');
    expect(saved.headingFont).toBe('serif');

    // Clearing is a business saying something — back to the platform's own look — rather than
    // an empty string the renderer would have to interpret.
    await setBrand(shop.db, {
      organizationId: shop.organizationId,
      accent: '',
      headingFont: 'sans',
      bodyFont: 'sans',
    });
    expect((await getBrand(shop.db, { organizationId: shop.organizationId })).accent).toBeNull();
  });

  it('refuses a colour that is not one, and a lettering it does not have', async () => {
    await expect(
      setBrand(shop.db, {
        organizationId: shop.organizationId,
        accent: 'nearly navy',
        headingFont: 'sans',
        bodyFont: 'sans',
      }),
    ).rejects.toMatchObject({ code: 'brand.colour_invalid' });

    await expect(
      setBrand(shop.db, {
        organizationId: shop.organizationId,
        accent: '#1f6feb',
        headingFont: 'comic',
        bodyFont: 'sans',
      }),
    ).rejects.toMatchObject({ code: 'brand.font_unknown' });
  });

  it('is not another business’s to read or to change', async () => {
    const other = await newBusiness('rival');

    await setBrand(other.db, {
      organizationId: other.organizationId,
      accent: '#00ff00',
      headingFont: 'mono',
      bodyFont: 'mono',
    });

    // RLS answers, not a filter in the application: this business sees the *default*, which is
    // what "no row you may read" resolves to, rather than the rival's green.
    expect(await getBrand(shop.db, { organizationId: other.organizationId })).toEqual(
      DEFAULT_BRAND,
    );

    // And the write is refused by the policy rather than by anything on a screen.
    await expect(
      setBrand(shop.db, {
        organizationId: other.organizationId,
        accent: '#000000',
        headingFont: 'sans',
        bodyFont: 'sans',
      }),
    ).rejects.toBeTruthy();
    expect((await getBrand(other.db, { organizationId: other.organizationId })).accent).toBe(
      '#00ff00',
    );
  });

  it('is settings, so a role without organization.manage cannot change it', async () => {
    // The line the UI system's amendment draws: how a business looks is a claim it makes about itself, in
    // the same way its tagline is, so it is gated by the capability that already owns that —
    // not by a new one nobody would grant separately.
    const roleId = await createRole(shop.db, {
      organizationId: shop.organizationId,
      name: 'Fitter',
      capabilities: ['work_item.create'],
    });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `fitter-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;

    await addMember(shop.db, {
      organizationId: shop.organizationId,
      email,
      roleId,
      displayName: 'Fitter',
    });

    const fitter = anonClient();
    const signIn = await fitter.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;

    await expect(
      setBrand(fitter, {
        organizationId: shop.organizationId,
        accent: '#ff0000',
        headingFont: 'sans',
        bodyFont: 'sans',
      }),
    ).rejects.toBeTruthy();

    // **And they still see it**, because a brand is rendered on every screen of this business —
    // a member who could not read it would see the platform's neutral look while a colleague
    // saw the business's.
    expect((await getBrand(fitter, { organizationId: shop.organizationId })).headingFont).toBe(
      'sans',
    );
  });
});
