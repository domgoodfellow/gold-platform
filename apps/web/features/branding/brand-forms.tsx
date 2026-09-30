'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { Card } from '@/components/surfaces/card';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import type { Brand } from '@/lib/domain/branding/brand';
import {
  FONT_KEYS,
  FONT_LABELS,
  PAGE_LIGHT,
  brandPalette,
  contrastRatio,
} from '@/lib/domain/branding/palette';
import { removeLogoAction, updateBrandAction, uploadLogoAction, type BrandState } from '@/app/organizations/[organizationId]/settings/actions';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';

const INITIAL: BrandState = { error: null };

/**
 * What this business looks like: one colour and a pair of lettering choices.
 *
 * **One colour and not five.** D23 records a five-role brand table, and that shape does not
 * survive being handed to somebody who is not a designer: five colours is five ways to put
 * unreadable text on your own screens. What a business has is a colour, so that is what it is
 * asked for — and `palette.ts` derives everything else, guaranteeing contrast rather than
 * hoping for it.
 *
 * **The preview is the point of the screen.** A colour picker with no consequence on screen
 * asks somebody to imagine the result, and the thing they cannot imagine is exactly the thing
 * this is protecting them from — that a pale yellow becomes a dark ochre when it is used as a
 * link, because on white it would otherwise be invisible. So the swatch shows the button and
 * the link as they will actually render, from the same function that renders them.
 */
export function BrandForm({
  organizationId,
  brand,
}: {
  organizationId: string;
  brand: Brand;
}) {
  const [state, formAction, pending] = useActionState(updateBrandAction, INITIAL);
  const [accent, setAccent] = useState(brand.accent ?? '');
  const [headingFont, setHeadingFont] = useState(brand.headingFont);
  const [bodyFont, setBodyFont] = useState(brand.bodyFont);

  // Rendered from the domain's own calculation, never from a copy of it. A preview computed a
  // second way is a preview that can disagree with the page, which is worse than none.
  const preview = accent ? brandPalette({ accent, headingFont, bodyFont }) : null;

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="accent">Your colour</FieldLabel>
        <div className="flex items-center gap-2">
          {/* A native colour input, because every browser already has a picker somebody knows
              how to use, and the text box beside it is for the person who has their hex code
              written down. Two controls over one value, which is the one case where that is
              right: they are two ways of knowing the same answer. */}
          <input
            type="color"
            aria-label="Pick a colour"
            value={accent || '#000000'}
            onChange={(event) => setAccent(event.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
          />
          <TextInput
            id="accent"
            name="accent"
            value={accent}
            onChange={(event) => setAccent(event.target.value)}
            placeholder="#1f6feb"
            maxLength={7}
            className="w-32 font-mono"
          />
          {accent ? (
            <Button type="button" tone="text" size="small" onClick={() => setAccent('')}>
              Clear
            </Button>
          ) : null}
        </div>
        <Hint weight="subtle">
          Leave it empty to use the platform&rsquo;s own look. Nothing else on the page changes
          colour — the page, the rules and the text stay as they are, so a colour can never make
          your own screens hard to read.
        </Hint>
      </div>

      <div className="flex flex-wrap gap-4">
        <FontChoice
          name="headingFont"
          label="Headings"
          value={headingFont}
          onChange={setHeadingFont}
        />
        <FontChoice name="bodyFont" label="Everything else" value={bodyFont} onChange={setBodyFont} />
      </div>

      {preview ? <Preview accent={accent} palette={preview} /> : null}

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <ErrorText role="alert">{state.error}</ErrorText>
      </div>
    </form>
  );
}

function FontChoice({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: 'sans' | 'serif' | 'mono') => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <SelectInput
        id={name}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value as 'sans' | 'serif' | 'mono')}
      >
        {FONT_KEYS.map((key) => (
          <option key={key} value={key}>
            {FONT_LABELS[key]}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}

/**
 * The colour as it will actually be used, and the number that says why.
 *
 * The ratio is shown rather than hidden because it is the one honest way to explain why the
 * link is not the colour they picked: this is what it had to become to stay readable, and here
 * is the measurement. A business that wanted the exact shade now knows to pick a darker one
 * rather than wondering whether the platform ignored them.
 */
function Preview({
  accent,
  palette,
}: {
  accent: string;
  palette: ReturnType<typeof brandPalette>;
}) {
  const ratio = contrastRatio(palette.accentTextLight, PAGE_LIGHT);

  return (
    <Card>
      <p className="text-sm font-medium" style={{ fontFamily: palette.headingFont }}>
        A heading in your lettering
      </p>
      <p className="mt-1 text-sm text-muted" style={{ fontFamily: palette.bodyFont }}>
        And a line of ordinary text beneath it.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span
          className="rounded px-3 py-1 text-sm"
          style={{ background: palette.accent, color: palette.onAccent }}
        >
          A button
        </span>
        <span
          className="text-sm underline underline-offset-4"
          style={{ color: palette.accentTextLight }}
        >
          A link
        </span>
      </div>

      {palette.accentTextLight.toLowerCase() !== accent.toLowerCase() ? (
        <Hint weight="subtle" className="mt-3">
          As a link on a light page your colour is darkened to {palette.accentTextLight} —{' '}
          {ratio.toFixed(1)}:1 against white, which is the readable threshold. Buttons keep the
          exact colour you chose.
        </Hint>
      ) : null}
    </Card>
  );
}

/**
 * A logo, and taking it down again.
 *
 * Its own form rather than a field on the one above, because it is its own act: the bytes go up
 * on their own, and a colour form that also carried a file would clear the logo every time
 * somebody changed a shade without touching the picker.
 */
export function LogoForm({
  organizationId,
  logoUrl,
}: {
  organizationId: string;
  logoUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(uploadLogoAction, INITIAL);
  const [removeState, removeAction, removing] = useActionState(removeLogoAction, INITIAL);

  return (
    <div className="mt-4 flex flex-col gap-3">
      {logoUrl ? (
        <div className="flex flex-wrap items-center gap-4">
          {/* A tenant's own upload in a public bucket, not a build-time asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="" className="max-h-12 w-auto max-w-48 object-contain" />
          <form id="remove-logo" action={removeAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <ConfirmSubmit
              formId="remove-logo"
              label="Remove"
              confirmLabel="Remove logo"
              description="Remove your logo? Public pages fall back to your business name."
              tone="danger"
              size="small"
              pending={removing}
            />
          </form>
        </div>
      ) : null}

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <FieldLabel htmlFor="logo">{logoUrl ? 'Replace it' : 'Upload one'}</FieldLabel>
        <input
          id="logo"
          name="logo"
          type="file"
          required
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="text-sm"
        />
        <Hint weight="subtle">
          PNG, JPEG, SVG or WebP, up to 2 MB. It appears beside your name here and at the top of
          your public page. Unlike everything else you upload, this one is on a public address —
          a logo is meant to be seen.
        </Hint>
        <Button type="submit" size="small" tone="secondary" disabled={pending} className="w-fit">
          {pending ? 'Uploading…' : 'Upload'}
        </Button>
      </form>

      <ErrorText role="alert">{state.error || removeState.error}</ErrorText>
    </div>
  );
}
