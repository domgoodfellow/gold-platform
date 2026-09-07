import { brandPalette } from '@/lib/domain/branding/palette';
import type { Brand } from '@/lib/domain/branding/brand';

/**
 * A business's own colour and lettering, as three overridden CSS custom properties and nothing
 * else — every control already reads a role rather than a literal (ui-spec §3), so a theme is
 * just where those values come from. Only accent/on-accent/accent-text ever change; background,
 * border, muted, subtle and danger stay the platform's, so a tenant can't make its own text or
 * its own refusals unreadable (§7). A `<style>` element rather than inline styles, because
 * `--accent-text` needs a dark-mode media query.
 */
export function BrandStyle({ brand }: { brand: Brand }) {
  if (!brand.accent) return null;

  const palette = brandPalette({
    accent: brand.accent,
    headingFont: brand.headingFont,
    bodyFont: brand.bodyFont,
  });

  // Never interpolate anything unvalidated into the CSS text below.
  const safe = (value: string) => (/^#[0-9a-f]{6}$/.test(value) ? value : null);
  const accent = safe(palette.accent);
  const onAccent = safe(palette.onAccent);
  const light = safe(palette.accentTextLight);
  const dark = safe(palette.accentTextDark);
  if (!accent || !onAccent || !light || !dark) return null;

  const css = [
    `[data-brand]{`,
    `--accent:${accent};`,
    `--on-accent:${onAccent};`,
    `--accent-text:${light};`,
    `--font-heading:${palette.headingFont};`,
    `--font-body:${palette.bodyFont};`,
    `}`,
    `@media (prefers-color-scheme:dark){[data-brand]{--accent-text:${dark};}}`,
  ].join('');

  return <style>{css}</style>;
}
