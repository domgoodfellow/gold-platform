/**
 * One colour in, a readable set of roles out — the whole reason a business may choose a colour
 * at all. Every role is computed here against WCAG AA (4.5:1 for text), so a business picks the
 * one colour it has and the platform guarantees it stays legible. One calculation only, the
 * same rule `priceWorkItem` and `freeWindows` are held to — a component asks for a role, never
 * derives one.
 */

/** What a business may pick from, and what each key means to the renderer. */
export const FONT_KEYS = ['sans', 'serif', 'mono'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const FONT_LABELS: Record<FontKey, string> = {
  sans: 'Plain',
  serif: 'Traditional',
  mono: 'Technical',
};

/** A tenant typing a family name would become a request to somebody else's server from every page — two of these already load via the root layout, the third is a system stack, so choosing one downloads nothing. */
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

/** Three-digit shorthand is expanded (a real colour, not a mistake); a named colour is refused, so the column never holds two spellings of one answer. */
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

/** WCAG 2.x relative luminance — the specification's own transfer function, not a perceptual approximation, since the AA threshold is defined in terms of exactly this formula. */
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

/** Black or white always reaches AA here — the worst-case background still gives 4.58:1 with the better of the two, so any accent colour a business picks stays legible with no adjustment. */
export function foregroundOn(background: string): string {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff')
    ? '#000000'
    : '#ffffff';
}

/**
 * The same colour, moved in lightness until it reads against `against`. Lightness only, so the
 * hue survives — a business's orange is still that orange as a link on white, just darker.
 * Walks in the direction that helps rather than binary-searching, since the ratio isn't
 * monotonic across the whole range (against a mid-grey page, both darker and lighter improve
 * it).
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

  // The walk ran out of room on this hue — black or white is the honest fallback.
  return foregroundOn(against);
}

/** Both schemes computed, since the page decides which it is at render time and a server guess would be wrong for half its readers. `onAccent` needs no scheme — the accent is its own background in both. */
export type BrandPalette = {
  accent: string;
  /** Black or white, whichever reads on `accent`. */
  onAccent: string;
  /** The accent as *text*, adjusted per scheme so a link is never unreadable. */
  accentTextLight: string;
  accentTextDark: string;
  headingFont: string;
  bodyFont: string;
};

/** Repeated from `globals.css`'s `--background` in each scheme, since this module can't read a stylesheet — `branding.test.ts` asserts the two agree. */
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

/** WCAG 2.1 non-text contrast (1.4.11): selected marks, outlines and indicators need 3:1 against what surrounds them. */
export const AA_NON_TEXT = 3;

/**
 * The organization palette: a primary (the existing `accent`), and optional secondary and highlight
 * roles. Each role is derived for both schemes, so any colour a business picks — black, white, a pale
 * pastel — stays legible as text and visible as an indicator. Semantic colours (success, warning,
 * error, destructive, disabled) and the focus ring are never part of this palette.
 */
export type BrandRole = {
  /** The colour as chosen (or derived). Used as a fill. */
  fill: string;
  /** Black or white, whichever reads on `fill` (≥ 4.5:1). */
  on: string;
  /** The colour as text on each page scheme (≥ 4.5:1). */
  textLight: string;
  textDark: string;
  /** The colour as a non-text indicator on each page scheme (≥ 3:1). */
  indicatorLight: string;
  indicatorDark: string;
};
export type OrganizationPalette = { primary: BrandRole; secondary: BrandRole; highlight: BrandRole; secondaryChosen: boolean; highlightChosen: boolean };

function role(fill: string): BrandRole {
  return {
    fill,
    on: foregroundOn(fill),
    textLight: readableOn(fill, PAGE_LIGHT),
    textDark: readableOn(fill, PAGE_DARK),
    indicatorLight: readableOn(fill, PAGE_LIGHT, AA_NON_TEXT),
    indicatorDark: readableOn(fill, PAGE_DARK, AA_NON_TEXT),
  };
}

/** A supporting colour when none is chosen: the primary's hue, softened toward the middle of the lightness range. */
export function derivedSecondary(primary: string): string {
  const hsl = toHsl(toRgb(primary));
  const l = hsl.l < 0.5 ? Math.min(0.72, hsl.l + 0.38) : Math.max(0.32, hsl.l - 0.38);
  return toHex(fromHsl({ ...hsl, s: hsl.s * 0.7, l }));
}

/** One function for the app and every preview: validated inputs in, all role variants out. */
export function organizationPalette(input: { primary: string | null; secondary?: string | null; highlight?: string | null }): OrganizationPalette {
  const primary = normaliseBrandColour(input.primary ?? '') ?? '#000000';
  const secondary = input.secondary ? normaliseBrandColour(input.secondary) : null;
  const highlight = input.highlight ? normaliseBrandColour(input.highlight) : null;
  return {
    primary: role(primary),
    secondary: role(secondary ?? derivedSecondary(primary)),
    highlight: role(highlight ?? primary),
    secondaryChosen: Boolean(secondary),
    highlightChosen: Boolean(highlight),
  };
}

/** Whole-palette starting points. Choosing one writes the same three values a typed hex would. */
export const PALETTE_PRESETS = [
  { key: 'monochrome', label: 'Monochrome', primary: '#111111', secondary: '#6b7280', highlight: null },
  { key: 'neutral-accent', label: 'Neutral with one accent', primary: '#334155', secondary: null, highlight: '#2563eb' },
  { key: 'complementary', label: 'Complementary', primary: '#1d4ed8', secondary: '#ea580c', highlight: null },
  { key: 'three-colour', label: 'Three colours', primary: '#0f766e', secondary: '#7c3aed', highlight: '#f59e0b' },
] as const;

/** Starting points for a business without a hex code. Values to pick, never stored as objects — choosing one writes the same accent a typed hex would. */
export const BRAND_PRESETS = [
  { label: 'Blue', value: '#2563eb' },
  { label: 'Teal', value: '#0f766e' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Orange', value: '#c2410c' },
  { label: 'Pink', value: '#be185d' },
  { label: 'Slate', value: '#334155' },
] as const;
