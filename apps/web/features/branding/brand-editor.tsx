'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';
import { updateBrandAction, type BrandState } from '@/app/organizations/[organizationId]/settings/actions';
import type { Brand } from '@/lib/domain/branding/brand';
import {
  BRAND_PRESETS,
  FONT_KEYS,
  FONT_LABELS,
  FONT_STACKS,
  PAGE_LIGHT,
  brandPalette,
  contrastRatio,
  normaliseBrandColour,
  type FontKey,
} from '@/lib/domain/branding/palette';
import { BrandPreview } from './brand-preview';
import { LogoControls } from './logo-controls';

const INITIAL: BrandState = { error: null };

/**
 * Persisted brand → local draft → preview → validated save → refreshed brand. The draft holds
 * only unsaved edits; the saved values stay the props, so the refresh after a save is what makes
 * the page agree with the database rather than this component's memory.
 */
export function BrandEditor({
  organizationId,
  brand,
  logoUrl,
  name,
  readOnly,
}: {
  organizationId: string;
  brand: Brand;
  logoUrl: string | null;
  name: string;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateBrandAction, INITIAL);
  const [accent, setAccent] = useState(brand.accent ?? '');
  const [headingFont, setHeadingFont] = useState<FontKey>(brand.headingFont);
  const [bodyFont, setBodyFont] = useState<FontKey>(brand.bodyFont);

  const normalised = accent.trim() === '' ? '' : normaliseBrandColour(accent);
  const invalid = normalised === null;
  // An unfinished hex keeps the preview on what is saved, and says so, rather than drawing black.
  const previewAccent = invalid ? brand.accent : normalised || null;

  const dirty =
    (normalised ?? accent) !== (brand.accent ?? '') ||
    headingFont !== brand.headingFont ||
    bodyFont !== brand.bodyFont;
  const isDefault = accent === '' && headingFont === 'sans' && bodyFont === 'sans';

  const link = previewAccent
    ? brandPalette({ accent: previewAccent, headingFont, bodyFont }).accentTextLight
    : null;

  return (
    <div className="mt-4 grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-8">
        <LogoControls organizationId={organizationId} logoUrl={logoUrl} name={name} readOnly={readOnly} />

        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="accent" value={normalised ?? accent} />
          <input type="hidden" name="headingFont" value={headingFont} />
          <input type="hidden" name="bodyFont" value={bodyFont} />

          <fieldset disabled={readOnly} className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Brand colour</legend>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Colour presets">
              {BRAND_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={normalised === preset.value}
                  onClick={() => setAccent(preset.value)}
                  style={{ background: preset.value }}
                  className="size-7 rounded-full border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-2 aria-pressed:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick a colour"
                value={normalised || '#000000'}
                onChange={(event) => setAccent(event.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent disabled:cursor-not-allowed"
              />
              <FieldLabel htmlFor="accent-hex" className="sr-only">
                Hex value
              </FieldLabel>
              <TextInput
                id="accent-hex"
                value={accent}
                onChange={(event) => setAccent(event.target.value)}
                placeholder="#1f6feb"
                maxLength={7}
                aria-invalid={invalid}
                aria-describedby="accent-note"
                className="w-32 font-mono"
              />
            </div>
            <div id="accent-note">
              {invalid ? (
                <ErrorText>
                  That is not a colour. Use six hex digits such as #1f6feb. The preview is still
                  showing what is saved.
                </ErrorText>
              ) : (
                <Hint weight="subtle">
                  {accent === ''
                    ? 'No colour chosen — the platform’s own neutral look.'
                    : link && link.toLowerCase() !== normalised
                      ? `Buttons use this exact colour. As a link on a light page it becomes ${link} (${contrastRatio(link, PAGE_LIGHT).toFixed(1)}:1) so it stays readable.`
                      : 'Used for buttons and links. Errors, warnings and success keep their own colours.'}
                </Hint>
              )}
            </div>
          </fieldset>

          <fieldset disabled={readOnly} className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-medium">Typography</legend>
            <FontChoice label="Headings" name="heading" value={headingFont} onChange={setHeadingFont} />
            <FontChoice label="Everything else" name="body" value={bodyFont} onChange={setBodyFont} />
          </fieldset>

          {readOnly ? (
            <Hint>Your role cannot change how this business looks.</Hint>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={pending || invalid || !dirty}>
                  {pending ? 'Saving…' : 'Save appearance'}
                </Button>
                <Button
                  type="button"
                  tone="secondary"
                  disabled={pending || !dirty}
                  onClick={() => {
                    setAccent(brand.accent ?? '');
                    setHeadingFont(brand.headingFont);
                    setBodyFont(brand.bodyFont);
                  }}
                >
                  Discard changes
                </Button>
                <Button
                  type="button"
                  tone="text"
                  disabled={pending || isDefault}
                  onClick={() => {
                    setAccent('');
                    setHeadingFont('sans');
                    setBodyFont('sans');
                  }}
                >
                  Use platform default
                </Button>
              </div>
              <div role="status" aria-live="polite" className="text-sm">
                {state.saved && !dirty ? <span className="text-success">Saved.</span> : null}
              </div>
              <ErrorText role="alert">{state.error}</ErrorText>
            </div>
          )}
        </form>
      </div>

      <div className="min-w-0 lg:sticky lg:top-4">
        <h2 className="mb-2 text-sm font-medium">Preview</h2>
        <BrandPreview
          accent={previewAccent}
          headingFont={headingFont}
          bodyFont={bodyFont}
          logoUrl={logoUrl}
          name={name}
        />
      </div>
    </div>
  );
}

function FontChoice({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: FontKey;
  onChange: (value: FontKey) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-sm text-muted">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        {FONT_KEYS.map((key) => (
          <label
            key={key}
            className={cx(
              'flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border border-border px-2 py-2 text-center has-[:checked]:border-foreground has-[:checked]:bg-selected has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
            )}
          >
            <input
              type="radio"
              name={`font-${name}`}
              value={key}
              checked={value === key}
              onChange={() => onChange(key)}
              className="sr-only"
            />
            <span aria-hidden style={{ fontFamily: FONT_STACKS[key] }} className="text-2xl leading-none">
              Aa
            </span>
            <span className="text-xs">{FONT_LABELS[key]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
