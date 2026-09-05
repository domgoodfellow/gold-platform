/**
 * One colour in, a readable set of roles out.
 *
 * **This is the whole reason a business may choose a colour at all.** D23 refused a per-tenant
 * theme partly because it is "configuration with a renderer", and the unstated half of that
 * objection is the dangerous one: a tenant who picks five colours has five ways to put
 * unreadable text on their own screens, and the platform would be shipping a product whose
 * legibility it does not control. So the business chooses the one colour it actually has, and
 * every role rendered from it is computed here against WCAG AA — 4.5:1 for text, which is the
 * threshold, not an aspiration.
 *
 * **There is one of these and there may not be a second.** The same rule `priceWorkItem` and
 * `freeWindows` are held to, for the same reason: a second contrast calculation is a second
 * answer to *is this readable*, and the one that gets forgotten is the one on the screen a
 * customer sees. A component that needs a colour asks for a role; it does not derive one.
 *
 * Nothing here touches the database and nothing here is per-tenant knowledge — it is arithmetic
 * on a hex string, which is why it is a module of its own rather than a corner of a page.
 */

/** What a business may pick from, and what each key means to the renderer. */
export const FONT_KEYS = ['sans', 'serif', 'mono'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const FONT_LABELS: Record<FontKey, string> = {
  sans: 'Plain',
  serif: 'Traditional',
  mono: 'Technical',
};

/**
 * The families this deployment actually loads, and the reason the list is short.
 *
 * A font is a file. A tenant typing a family name would either do nothing or become a request
 * to somebody else's server from every page this platform renders on their behalf — a privacy
 * decision made by a text box. Two of these are already loaded by the root layout and the third
 * is a system stack, so choosing one costs nothing and downloads nothing.
 */
export const FONT_STACKS: Record<FontKey, string> = {
  sans: 'var(--font-geist-sans), system-ui, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  mono: 'var(--font-geist-mono), ui-monospace, monospace',
};

export function isFontKey(value: string): value is FontKey {
  return (FONT_KEYS as readonly string[]).includes(value);
}

/** Lowercase `#rrggbb`, which is the one spelling the column accepts. */
const HEX = /^#[0-9a-f]{6}$/;

export function isBrandColour(value: string): boolean {
  return HEX.test(value.trim().toLowerCase());
}

/**
 * Normalise what somebody typed, or say it is not a colour.
 *
 * A native colour input always produces `#rrggbb`, so this exists for the paths that are not
 * one: a pasted value, a proposal drafted by a model, a hand-written test. Three-digit shorthand
 * is expanded rather than refused, because `#0af` is a colour somebody wrote and not a mistake;
 * a named colour is refused, because accepting `rebeccapurple` would mean the column holds two
 * spellings of one answer.
 */
export function normaliseBrandColour(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(trimmed);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;

  return HEX.test(trimmed) ? trimmed : null;
}

type Rgb = { r: number; g: number; b: number };

function toRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * WCAG 2.x relative luminance.
 *
 * The channel transfer function is the specification's, not a perceptual approximation: the
 * threshold this is compared against is defined in terms of exactly this formula, so a
 * different curve would produce a number that is not the thing the threshold is about.
 */
function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The ratio itself, always ≥ 1 and ≤ 21. */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(toRgb(a));
  const second = luminance(toRgb(b));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal text. Large text is 3:1 and nothing here relies on being large. */
export const AA_TEXT = 4.5;

// --- HSL, used only to move lightness without moving hue -------------------

type Hsl = { h: number; s: number; l: number };

function toHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
}

/**
 * Whichever of black or white reads on this colour.
 *
 * **This one cannot fail, and that is worth knowing rather than assuming.** The worst possible
 * background is the one where black and white are equally bad, and there the better of the two
 * is still 4.58:1 — above the threshold. So a business may pick any colour at all for a button
 * and the label on it is always legible, with no adjustment to the colour they chose.
 */
export function foregroundOn(background: string): string {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff')
    ? '#000000'
    : '#ffffff';
}

/**
 * The same colour, moved in lightness until it reads against `against`.
 *
 * **Lightness only, so the hue survives.** A business that picked a particular orange is still
 * that orange when it appears as a link on white — darker, and recognisably theirs. Changing
 * the hue to reach the threshold would be the platform picking a different colour and not
 * saying so.
 *
 * Walks in the direction that helps rather than binary-searching, because the ratio is not
 * monotonic across the whole range: against a mid-grey page both darker and lighter improve it,
 * and a search assuming one direction settles on the wrong side. Sixty steps of a hundredth is
 * finer than the eight bits the result is quantised to anyway.
 */
export function readableOn(colour: string, against: string, target = AA_TEXT): string {
  if (contrastRatio(colour, against) >= target) return colour;

  const hsl = toHsl(toRgb(colour));
  // Away from the page: darken on a light background, lighten on a dark one.
  const direction = luminance(toRgb(against)) > 0.179 ? -1 : 1;

  for (let step = 1; step <= 100; step += 1) {
    const l = hsl.l + direction * step * 0.01;
    if (l < 0 || l > 1) break;
    const candidate = toHex(fromHsl({ ...hsl, l }));
    if (contrastRatio(candidate, against) >= target) return candidate;
  }

  // Nothing on this hue reached the threshold, which happens only when the walk ran out of
  // room. Black or white is the honest fallback: it is readable, and a business that chose a
  // colour this close to its own page background has been given the only legible answer.
  return foregroundOn(against);
}

/**
 * What a business's brand actually renders as.
 *
 * Both schemes are computed, because the page decides which it is at render time and a
 * server that guessed would be wrong for half its readers. `onAccent` needs no scheme: the
 * accent is the background there, and it is the same colour in both.
 */
export type BrandPalette = {
  /** The colour as chosen, used where it is a background under chosen text. */
  accent: string;
  /** Black or white, whichever reads on `accent`. */
  onAccent: string;
  /** The accent as *text*, adjusted per scheme so a link is never unreadable. */
  accentTextLight: string;
  accentTextDark: string;
  headingFont: string;
  bodyFont: string;
};

/**
 * The two page colours the roles are derived against.
 *
 * These are `globals.css`'s `--background` in each scheme, repeated here because this module
 * cannot read a stylesheet — and a comment is a weaker link than a test, so
 * `branding.test.ts` asserts the two agree.
 */
export const PAGE_LIGHT = '#ffffff';
export const PAGE_DARK = '#0a0a0a';

export function brandPalette(input: {
  accent: string;
  headingFont: FontKey;
  bodyFont: FontKey;
}): BrandPalette {
  const accent = normaliseBrandColour(input.accent) ?? '#000000';

  return {
    accent,
    onAccent: foregroundOn(accent),
    accentTextLight: readableOn(accent, PAGE_LIGHT),
    accentTextDark: readableOn(accent, PAGE_DARK),
    headingFont: FONT_STACKS[input.headingFont],
    bodyFont: FONT_STACKS[input.bodyFont],
  };
}
