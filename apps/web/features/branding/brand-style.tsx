import { brandPalette } from '@/lib/domain/branding/palette';
import type { Brand } from '@/lib/domain/branding/brand';

/**
 * A business's own colour and lettering, as three overridden roles and nothing else.
 *
 * **This is the entire renderer for a per-tenant theme, and it is this small on purpose.**
 * `ui-spec.md` §3 required every control to read a colour role rather than a literal, saying
 * that is "what makes a per-tenant theme a question of where values come from rather than a
 * second pass over every control". This is that promise being collected: no control changed, no
 * component learned about brands, and a screen still asks for `bg-accent` without knowing whose
 * accent it is.
 *
 * **Three roles, not seven.** `--background`, `--foreground`, `--border`, `--muted`, `--subtle`
 * and `--danger` stay the platform's in every tenant. A business overriding its own page
 * background is a business that can make its own text vanish, and `danger` is a refusal — a
 * tenant recolouring what a refusal looks like is the same mistake as a tenant naming a status
 * `success` (§7). What a business gets is the colour it actually has, wherever this application
 * was already drawing emphasis.
 *
 * **A `<style>` element rather than an inline `style` attribute**, and the reason is
 * `--accent-text`: a colour legible as a link on white is not legible on near-black, so the two
 * are computed separately and one of them lives inside a media query. An inline style cannot
 * hold a media query, so it could only have carried whichever scheme the server guessed — and
 * the server does not know which the reader is in.
 *
 * **Nothing here interpolates anything a person typed.** Every value is produced by
 * `brandPalette` from a colour that matched `^#[0-9a-f]{6}$` at the column, at the domain and
 * again on the way in below, and each font is a stack this file's own map returned for a key
 * from a closed list. That is what makes writing CSS text safe: not that the input was
 * escaped, but that no input reaches the output.
 */
export function BrandStyle({ brand }: { brand: Brand }) {
  // A business that has said nothing renders the platform's own look, and the honest way to do
  // that is to emit no rule at all rather than a rule that restates the defaults. `globals.css`
  // already holds them, and a second copy here would be the second place they live.
  if (!brand.accent) return null;

  const palette = brandPalette({
    accent: brand.accent,
    headingFont: brand.headingFont,
    bodyFont: brand.bodyFont,
  });

  // Belt to the column's braces: a value that did not come back from `brandPalette` in the
  // shape a hex colour has is dropped rather than written. Unreachable through every path that
  // exists today, which is the point of checking it at the boundary that writes CSS.
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
