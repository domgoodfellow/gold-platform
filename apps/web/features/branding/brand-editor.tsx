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
  PALETTE_PRESETS,
  contrastRatio,
  normaliseBrandColour,
  organizationPalette,
  type FontKey,
} from '@/lib/domain/branding/palette';
import { BrandPreview } from './brand-preview';
import { LogoControls } from './logo-controls';

const INITIAL: BrandState = { error: null };
type RoleKey = 'accent' | 'secondary' | 'highlight';

/**
 * Persisted brand → local draft → preview → validated save → refreshed brand. The draft holds
 * only unsaved edits; the saved values stay the props, so the refresh after a save is what makes
 * the page agree with the database rather than this component's memory.
 *
 * Three colour roles: Primary (identity, primary actions, selected states), Secondary (supporting
 * decoration) and Highlight (non-semantic emphasis). Only Primary is needed; the others can be
 * cleared and then follow the primary. Errors, warnings and success always keep their own colours.
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
  const [colours, setColours] = useState<Record<RoleKey, string>>({ accent: brand.accent ?? '', secondary: brand.secondary ?? '', highlight: brand.highlight ?? '' });
  const [headingFont, setHeadingFont] = useState<FontKey>(brand.headingFont);
  const [bodyFont, setBodyFont] = useState<FontKey>(brand.bodyFont);
  const set = (key: RoleKey, value: string) => setColours(current => ({ ...current, [key]: value }));

  const normalised = Object.fromEntries((Object.keys(colours) as RoleKey[]).map(key => [key, colours[key].trim() === '' ? '' : normaliseBrandColour(colours[key])])) as Record<RoleKey, string | null>;
  const invalid = (Object.values(normalised) as (string | null)[]).some(value => value === null);
  // An unfinished hex keeps the preview on what is saved, and says so, rather than drawing black.
  const saved = { accent: brand.accent, secondary: brand.secondary ?? null, highlight: brand.highlight ?? null };
  const preview = (key: RoleKey) => (normalised[key] === null ? saved[key] : normalised[key] || null);

  const dirty =
    (Object.keys(colours) as RoleKey[]).some(key => (normalised[key] ?? colours[key]) !== (saved[key] ?? '')) ||
    headingFont !== brand.headingFont ||
    bodyFont !== brand.bodyFont;
  const isDefault = Object.values(colours).every(value => value === '') && headingFont === 'sans' && bodyFont === 'sans';
  const link = preview('accent') ? organizationPalette({ primary: preview('accent') }).primary.textLight : null;

  return (
    <div className="mt-4 grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-8">
        <LogoControls organizationId={organizationId} logoUrl={logoUrl} name={name} readOnly={readOnly} />

        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="accent" value={normalised.accent ?? colours.accent} />
          <input type="hidden" name="secondary" value={normalised.secondary ?? colours.secondary} />
          <input type="hidden" name="highlight" value={normalised.highlight ?? colours.highlight} />
          <input type="hidden" name="headingFont" value={headingFont} />
          <input type="hidden" name="bodyFont" value={bodyFont} />

          <fieldset disabled={readOnly} className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">Brand palette</legend>
            <div role="group" aria-label="Palette presets" className="grid grid-cols-2 gap-2">
              {PALETTE_PRESETS.map(preset => {
                const active = normalised.accent === preset.primary && (normalised.secondary || '') === (preset.secondary ?? '') && (normalised.highlight || '') === (preset.highlight ?? '');
                return <button key={preset.key} type="button" aria-pressed={active}
                  onClick={() => setColours({ accent: preset.primary, secondary: preset.secondary ?? '', highlight: preset.highlight ?? '' })}
                  className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-xs font-medium outline-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-foreground aria-pressed:bg-selected disabled:cursor-not-allowed disabled:opacity-60">
                  <span aria-hidden className="flex shrink-0">{[preset.primary, preset.secondary, preset.highlight].filter(Boolean).map(value => <span key={value} style={{ background: value! }} className="-ml-1 size-4 rounded-full border border-border first:ml-0" />)}</span>
                  {preset.label}
                </button>;
              })}
            </div>
          </fieldset>

          <fieldset disabled={readOnly} className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Primary colour</legend>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Colour presets">
              {BRAND_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={normalised.accent === preset.value}
                  onClick={() => set('accent', preset.value)}
                  style={{ background: preset.value }}
                  className="size-7 rounded-full border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-2 aria-pressed:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
                />
              ))}
            </div>
            <ColourInput id="accent-hex" label="Hex value" pickerLabel="Pick a colour" value={colours.accent} valid={normalised.accent !== null} onChange={value => set('accent', value)} />
            <div id="accent-hex-note">
              {normalised.accent === null ? (
                <ErrorText>That is not a colour. Use six hex digits such as #1f6feb. The preview is still showing what is saved.</ErrorText>
              ) : (
                <Hint weight="subtle">
                  {colours.accent === ''
                    ? 'No colour chosen — the platform’s own neutral look.'
                    : link && link.toLowerCase() !== normalised.accent
                      ? `Buttons use this exact colour. As a link on a light page it becomes ${link} (${contrastRatio(link, PAGE_LIGHT).toFixed(1)}:1) so it stays readable.`
                      : 'Used for primary actions, selected states and links. Errors, warnings and success keep their own colours.'}
                </Hint>
              )}
            </div>
          </fieldset>

          {(['secondary', 'highlight'] as const).map(key => (
            <fieldset key={key} disabled={readOnly || !colours.accent} className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{key === 'secondary' ? 'Secondary colour' : 'Highlight colour'} <span className="font-normal text-subtle">(optional)</span></legend>
              <div className="flex flex-wrap items-center gap-2">
                <ColourInput id={`${key}-hex`} label={key === 'secondary' ? 'Secondary hex value' : 'Highlight hex value'} pickerLabel={key === 'secondary' ? 'Pick a secondary colour' : 'Pick a highlight colour'} value={colours[key]} valid={normalised[key] !== null} onChange={value => set(key, value)} />
                {colours[key] ? <Button type="button" tone="text" size="small" onClick={() => set(key, '')}>Clear</Button> : null}
              </div>
              {normalised[key] === null ? <ErrorText>That is not a colour. Use six hex digits such as #1f6feb.</ErrorText>
                : <Hint weight="subtle">{key === 'secondary'
                  ? (colours.secondary ? 'Used for supporting accents and decorative backgrounds.' : 'Not chosen — a softer shade of the primary is used.')
                  : (colours.highlight ? 'Used for non-semantic emphasis such as highlighted marks.' : 'Not chosen — the primary is used.')}</Hint>}
            </fieldset>
          ))}

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
                    setColours({ accent: brand.accent ?? '', secondary: brand.secondary ?? '', highlight: brand.highlight ?? '' });
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
                    setColours({ accent: '', secondary: '', highlight: '' });
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
          accent={preview('accent')}
          secondary={preview('accent') ? preview('secondary') : null}
          highlight={preview('accent') ? preview('highlight') : null}
          headingFont={headingFont}
          bodyFont={bodyFont}
          logoUrl={logoUrl}
          name={name}
        />
      </div>
    </div>
  );
}

function ColourInput({ id, label, pickerLabel, value, valid, onChange }: { id: string; label: string; pickerLabel: string; value: string; valid: boolean; onChange: (value: string) => void }) {
  const normalised = value.trim() === '' ? '' : normaliseBrandColour(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={pickerLabel}
        value={normalised || '#000000'}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent disabled:cursor-not-allowed"
      />
      <FieldLabel htmlFor={id} className="sr-only">{label}</FieldLabel>
      <TextInput
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="#1f6feb"
        maxLength={7}
        aria-invalid={!valid}
        aria-describedby={`${id}-note`}
        className="w-32 font-mono"
      />
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
