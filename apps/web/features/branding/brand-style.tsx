import type { CSSProperties } from 'react';
import { FONT_STACKS, organizationPalette, type FontKey, type OrganizationPalette } from '@/lib/domain/branding/palette';
import type { Brand } from '@/lib/domain/branding/brand';

/**
 * A business's own colours and lettering, as overridden CSS custom properties and nothing else —
 * every control already reads a role rather than a literal (`docs/ui-system.md`), so a theme is just
 * where those values come from. Only the brand roles and the two font stacks ever change; background,
 * border, muted, subtle, the focus ring and the semantic roles (success, warning, error,
 * destructive, disabled) stay the platform's, so a tenant can't make its own text or refusals
 * unreadable.
 *
 * `brandTokens` is the one place a palette becomes custom properties. The shell's `<style>` and both
 * previews (Branding and Appearance) go through it, so a preview cannot disagree with the page.
 *
 * Token map (V1.4):
 *   --accent / --on-accent / --accent-text   primary: primary actions, selected states, links
 *   --accent-indicator                       primary as a ≥3:1 mark (selected rails, outlines)
 *   --brand-secondary / --on-brand-secondary / --brand-secondary-text   supporting decoration
 *   --brand-highlight / --on-brand-highlight / --brand-highlight-indicator   non-semantic emphasis
 */

const HEX = /^#[0-9a-f]{6}$/;
type Scheme = 'light' | 'dark' | 'both';

/** Everything interpolated into CSS comes from a validated palette, never from raw input. */
function valid(palette: OrganizationPalette): boolean {
  return [palette.primary, palette.secondary, palette.highlight].every(role => Object.values(role).every(value => HEX.test(value)));
}

/** The brand roles as custom properties for one scheme, or for both with `light-dark()` (the app shell). */
export function brandTokens(input: { accent: string | null; secondary?: string | null; highlight?: string | null }, scheme: Scheme): Record<string, string> | null {
  if (!input.accent) return null;
  const palette = organizationPalette({ primary: input.accent, secondary: input.secondary, highlight: input.highlight });
  if (!valid(palette)) return null;
  const pick = (light: string, dark: string) => scheme === 'light' ? light : scheme === 'dark' ? dark : `light-dark(${light},${dark})`;
  const { primary, secondary, highlight } = palette;
  return {
    '--brand-accent': primary.fill, '--brand-on-accent': primary.on,
    '--brand-link-light': primary.textLight, '--brand-link-dark': primary.textDark,
    '--accent': primary.fill, '--on-accent': primary.on,
    '--accent-text': pick(primary.textLight, primary.textDark),
    '--accent-indicator': pick(primary.indicatorLight, primary.indicatorDark),
    '--brand-secondary': secondary.fill, '--on-brand-secondary': secondary.on,
    '--brand-secondary-text': pick(secondary.textLight, secondary.textDark),
    '--brand-highlight': highlight.fill, '--on-brand-highlight': highlight.on,
    '--brand-highlight-indicator': pick(highlight.indicatorLight, highlight.indicatorDark),
  };
}

/** The roles as inline properties, for one named scheme — the previews' scope. */
export function brandStyleProperties(
  input: { accent: string | null; secondary?: string | null; highlight?: string | null; headingFont: FontKey; bodyFont: FontKey },
  scheme: 'light' | 'dark',
): CSSProperties {
  const tokens = brandTokens(input, scheme);
  const properties: Record<string, string> = {
    '--font-heading': FONT_STACKS[input.headingFont],
    '--font-body': FONT_STACKS[input.bodyFont],
    // No brand: the platform's neutral roles, written out so a nested preview never inherits the shell's brand.
    '--accent': 'var(--foreground)',
    '--on-accent': 'var(--background)',
    '--accent-text': 'var(--foreground)',
    '--accent-indicator': 'var(--foreground)',
    '--brand-secondary': 'var(--muted)', '--on-brand-secondary': 'var(--background)', '--brand-secondary-text': 'var(--muted)',
    '--brand-highlight': 'var(--foreground)', '--on-brand-highlight': 'var(--background)', '--brand-highlight-indicator': 'var(--foreground)',
    ...(tokens ?? {}),
  };
  return properties as CSSProperties;
}

export function BrandStyle({ brand }: { brand: Brand }) {
  const customFonts = brand.headingFont !== 'sans' || brand.bodyFont !== 'sans';
  if (!brand.accent && !customFonts) return null;

  const fonts = [
    `--brand-font-heading:${FONT_STACKS[brand.headingFont]};`,
    `--brand-font-body:${FONT_STACKS[brand.bodyFont]};`,
    `--font-heading:${FONT_STACKS[brand.headingFont]};`,
    `--font-body:${FONT_STACKS[brand.bodyFont]};`,
  ];
  const tokens = brand.accent ? brandTokens(brand, 'both') : null;
  if (brand.accent && !tokens) return null;
  const rules = [...Object.entries(tokens ?? {}).map(([name, value]) => `${name}:${value};`), ...fonts];

  // Scoped to `[data-brand]`, which only this organization's shell carries; switching organizations
  // renders the other organization's <style> and this one is removed with its layout.
  return <style>{`[data-brand]{${rules.join('')}}`}</style>;
}
