import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandStyle, brandStyleProperties } from '@/features/branding/brand-style';
import {
  AA_TEXT,
  PAGE_DARK,
  PAGE_LIGHT,
  brandPalette,
  contrastRatio,
  normaliseBrandColour,
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
