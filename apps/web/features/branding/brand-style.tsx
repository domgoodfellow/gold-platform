import type { CSSProperties } from 'react';
import { brandPalette, type BrandPalette, type FontKey } from '@/lib/domain/branding/palette';
import type { Brand } from '@/lib/domain/branding/brand';

/**
 * A business's own colour and lettering, as overridden CSS custom properties and nothing else —
 * every control already reads a role rather than a literal (`docs/ui-system.md`), so a theme is just
 * where those values come from. Only accent/on-accent/accent-text and the two font stacks ever
 * change; background, border, muted, subtle and the semantic roles stay the platform's, so a
 * tenant can't make its own text or its own refusals unreadable.
 *
 * `brandRoles` is the one place a palette becomes custom properties. The shell's `<style>` and
 * the Branding preview both go through it, so the preview cannot disagree with the page.
 */

const HEX = /^#[0-9a-f]{6}$/;

/** Everything interpolated into CSS comes from a validated palette, never from raw input. */
function brandRoles(palette: BrandPalette): { accent: string; onAccent: string; light: string; dark: string } | null {
  const { accent, onAccent, accentTextLight: light, accentTextDark: dark } = palette;
  if (![accent, onAccent, light, dark].every((value) => HEX.test(value))) return null;
  return { accent, onAccent, light, dark };
}

/** The roles as inline properties, for one named scheme — the Branding preview's scope. */
export function brandStyleProperties(
  input: { accent: string | null; headingFont: FontKey; bodyFont: FontKey },
  scheme: 'light' | 'dark',
): CSSProperties {
  const palette = brandPalette({ ...input, accent: input.accent ?? '#000000' });
  const roles = input.accent ? brandRoles(palette) : null;
  const properties: Record<string, string> = {
    '--font-heading': palette.headingFont,
    '--font-body': palette.bodyFont,
    '--accent': roles?.accent ?? 'var(--foreground)',
    '--on-accent': roles?.onAccent ?? 'var(--background)',
    '--accent-text': roles ? (scheme === 'dark' ? roles.dark : roles.light) : 'var(--foreground)',
  };
  return properties as CSSProperties;
}

export function BrandStyle({ brand }: { brand: Brand }) {
  const customFonts = brand.headingFont !== 'sans' || brand.bodyFont !== 'sans';
  if (!brand.accent && !customFonts) return null;

  const palette = brandPalette({
    accent: brand.accent ?? '#000000',
    headingFont: brand.headingFont,
    bodyFont: brand.bodyFont,
  });

  const rules = [
    `--brand-font-heading:${palette.headingFont};`,
    `--brand-font-body:${palette.bodyFont};`,
    `--font-heading:${palette.headingFont};`,
    `--font-body:${palette.bodyFont};`,
  ];

  if (brand.accent) {
    const roles = brandRoles(palette);
    if (!roles) return null;
    rules.unshift(`--brand-accent:${roles.accent};`, `--brand-on-accent:${roles.onAccent};`, `--brand-link-light:${roles.light};`, `--brand-link-dark:${roles.dark};`, `--accent:${roles.accent};`, `--on-accent:${roles.onAccent};`, `--accent-text:light-dark(${roles.light},${roles.dark});`);
  }

  return <style>{`[data-brand]{${rules.join('')}}`}</style>;
}
