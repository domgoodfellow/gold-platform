import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandStyle, brandStyleProperties, brandTokens } from '@/features/branding/brand-style';
import {
  AA_NON_TEXT,
  AA_TEXT,
  PAGE_DARK,
  PAGE_LIGHT,
  PALETTE_PRESETS,
  brandPalette,
  contrastRatio,
  normaliseBrandColour,
  organizationPalette,
} from '@/lib/domain/branding/palette';
import { DEFAULT_BRAND } from '@/lib/domain/branding/brand';

const NAMED = {
  'very light yellow': '#ffffcc',
  white: '#ffffff',
  black: '#000000',
  'saturated blue': '#0000ff',
  'saturated red': '#ff0000',
  'saturated green': '#00ff00',
  'mid grey': '#808080',
} as const;

describe('brand palette roles', () => {
  for (const [label, hex] of Object.entries(NAMED)) {
    it(`keeps ${label} legible as a button, as a link in light, and as a link in dark`, () => {
      const palette = brandPalette({ accent: hex, headingFont: 'sans', bodyFont: 'sans' });
      expect(palette.accent).toBe(hex);
      expect(contrastRatio(palette.accent, palette.onAccent)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(palette.accentTextLight, PAGE_LIGHT)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(palette.accentTextDark, PAGE_DARK)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  it('expands shorthand and refuses a malformed value instead of substituting one', () => {
    expect(normaliseBrandColour('#abc')).toBe('#aabbcc');
    expect(normaliseBrandColour('#12')).toBeNull();
    expect(normaliseBrandColour('blue')).toBeNull();
  });
});

describe('organization palette', () => {
  const legible = (role: ReturnType<typeof organizationPalette>['primary']) => {
    expect(contrastRatio(role.fill, role.on)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(role.textLight, PAGE_LIGHT)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(role.textDark, PAGE_DARK)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(role.indicatorLight, PAGE_LIGHT)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrastRatio(role.indicatorDark, PAGE_DARK)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  };

  for (const [label, hex] of Object.entries(NAMED)) {
    it(`keeps every role legible when ${label} is the primary, secondary and highlight`, () => {
      const palette = organizationPalette({ primary: hex, secondary: hex, highlight: hex });
      legible(palette.primary); legible(palette.secondary); legible(palette.highlight);
      const derived = organizationPalette({ primary: hex });
      legible(derived.secondary); legible(derived.highlight);
    });
  }

  it('keeps a legacy single-colour brand exactly as it looked', () => {
    const legacy = brandPalette({ accent: '#c2410c', headingFont: 'sans', bodyFont: 'sans' });
    const palette = organizationPalette({ primary: '#c2410c' });
    expect(palette.primary.fill).toBe(legacy.accent);
    expect(palette.primary.on).toBe(legacy.onAccent);
    expect(palette.primary.textLight).toBe(legacy.accentTextLight);
    expect(palette.primary.textDark).toBe(legacy.accentTextDark);
    expect(palette.highlight.fill).toBe(legacy.accent);
    expect(palette.secondaryChosen).toBe(false);
    expect(palette.highlightChosen).toBe(false);
  });

  it('records which optional roles were chosen and derives the rest', () => {
    const palette = organizationPalette({ primary: '#0f766e', secondary: '#7C3AED', highlight: '' });
    expect(palette.secondary.fill).toBe('#7c3aed');
    expect(palette.secondaryChosen).toBe(true);
    expect(palette.highlight.fill).toBe('#0f766e');
    expect(palette.highlightChosen).toBe(false);
  });

  it('offers the four presets with legible roles', () => {
    expect(PALETTE_PRESETS.map(preset => preset.key)).toEqual(['monochrome', 'neutral-accent', 'complementary', 'three-colour']);
    for (const preset of PALETTE_PRESETS) {
      const palette = organizationPalette(preset);
      legible(palette.primary); legible(palette.secondary); legible(palette.highlight);
    }
  });

  it('emits the brand roles only, with light-dark() for the shell and fixed values per preview scheme', () => {
    const both = brandTokens({ accent: '#ffffcc', secondary: '#000000', highlight: '#ffffff' }, 'both')!;
    expect(both['--accent-text']).toMatch(/^light-dark\(#[0-9a-f]{6},#[0-9a-f]{6}\)$/);
    expect(Object.keys(both).every(name => /^--(brand-|accent|on-accent|on-brand-)/.test(name))).toBe(true);
    const light = brandTokens({ accent: '#ffffcc' }, 'light')!;
    expect(light['--accent-text']).toBe(organizationPalette({ primary: '#ffffcc' }).primary.textLight);
    expect(brandTokens({ accent: null, secondary: '#7c3aed' }, 'both')).toBeNull();
  });
});

describe('brand scope', () => {
  const markup = (brand: Parameters<typeof BrandStyle>[0]['brand']) =>
    renderToStaticMarkup(BrandStyle({ brand }) ?? null);

  it('writes nothing for a business that has said nothing', () => {
    expect(markup(DEFAULT_BRAND)).toBe('');
  });

  it('writes only brand roles and the two fonts, scoped to [data-brand]', () => {
    const css = markup({ ...DEFAULT_BRAND, accent: '#2563eb', headingFont: 'serif' });
    expect(css).toContain('[data-brand]{');
    for (const role of ['--accent:', '--on-accent:', '--accent-text:', '--font-heading:', '--font-body:']) {
      expect(css).toContain(role);
    }
    expect(css).not.toMatch(/--(danger|warning|success|background|foreground|border)/);
  });

  it('applies a chosen font even when no accent was chosen', () => {
    const css = markup({ ...DEFAULT_BRAND, bodyFont: 'mono' });
    expect(css).toContain('--font-body:');
    expect(css).not.toContain('--accent:');
  });

  it('gives the preview the same roles the page gets, per scheme', () => {
    const palette = brandPalette({ accent: '#ffffcc', headingFont: 'sans', bodyFont: 'sans' });
    const input = { accent: '#ffffcc', headingFont: 'sans', bodyFont: 'sans' } as const;
    const light = brandStyleProperties(input, 'light') as Record<string, string>;
    const dark = brandStyleProperties(input, 'dark') as Record<string, string>;
    expect(light['--accent']).toBe(palette.accent);
    expect(light['--accent-text']).toBe(palette.accentTextLight);
    expect(dark['--accent-text']).toBe(palette.accentTextDark);
  });

  it('previews the platform default when there is no accent', () => {
    const style = brandStyleProperties({ accent: null, headingFont: 'sans', bodyFont: 'sans' }, 'light') as Record<string, string>;
    expect(style['--accent']).toBe('var(--foreground)');
  });
});
