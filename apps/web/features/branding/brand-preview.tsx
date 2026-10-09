'use client';

import { useState } from 'react';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { Card } from '@/components/surfaces/card';
import { cx } from '@/components/class-names';
import type { FontKey } from '@/lib/domain/branding/palette';
import { brandStyleProperties } from './brand-style';

type Scheme = 'light' | 'dark';
type Surface = 'workspace' | 'customer';
type Width = 'wide' | 'narrow';

/**
 * The draft, rendered with the same shared controls the application uses, inside a scope that
 * carries the same custom properties `BrandStyle` writes. Nothing here computes a colour: the
 * roles come from `brandStyleProperties`, which reads `brandPalette`, so what shows is what the
 * page will do.
 */
export function BrandPreview({
  accent,
  headingFont,
  bodyFont,
  logoUrl,
  name,
}: {
  /** A valid, normalised accent, or null for the platform's own look. */
  accent: string | null;
  headingFont: FontKey;
  bodyFont: FontKey;
  logoUrl: string | null;
  name: string;
}) {
  const [scheme, setScheme] = useState<Scheme>('light');
  const [surface, setSurface] = useState<Surface>('workspace');
  const [width, setWidth] = useState<Width>('wide');

  const style = brandStyleProperties({ accent, headingFont, bodyFont }, scheme);

  const mark = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />
  ) : (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-foreground text-sm font-semibold text-background"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Preview surface"
          value={surface}
          onChange={setSurface}
          options={[
            ['workspace', 'Your workspace'],
            ['customer', 'Customer page'],
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Preview width"
            value={width}
            onChange={setWidth}
            options={[
              ['wide', 'Desktop'],
              ['narrow', 'Phone'],
            ]}
          />
          <Segmented
            label="Preview appearance"
            value={scheme}
            onChange={setScheme}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-secondary p-3 sm:p-4">
        <div
          data-brand
          data-appearance={scheme}
          data-testid="brand-preview"
          style={style}
          className={cx(
            'mx-auto w-full rounded-lg border border-border',
            width === 'narrow' ? 'max-w-[22rem]' : 'max-w-none',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            {mark}
            <span className="min-w-0 truncate text-sm font-medium">{name}</span>
          </div>

          {surface === 'workspace' ? (
            <div className="flex flex-col gap-4 p-4">
              <div>
                <h3 className="text-lg font-semibold">Today&rsquo;s schedule</h3>
                <p className="text-sm text-muted">Three visits, one waiting for confirmation.</p>
              </div>
              <ul className="flex flex-col gap-1 text-sm" aria-label="Sample list">
                <li className="rounded-md bg-selected px-3 py-2">Boiler service · 09:00 (selected)</li>
                <li className="rounded-md px-3 py-2 hover:bg-hover">Quote follow-up · 11:30</li>
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button">Add visit</Button>
                <Button type="button" tone="secondary">Filter</Button>
                <Button type="button" tone="danger">Cancel visit</Button>
                <Button type="button" tone="text">View all</Button>
              </div>
              <TextInput aria-label="Sample field" placeholder="A field, focus it to see the ring" />
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div>
                <h3 className="text-lg font-semibold">Book a visit</h3>
                <p className="text-sm text-muted">Choose a time that suits you.</p>
              </div>
              <Card>
                <p className="text-sm font-medium">Upcoming appointment</p>
                <p className="mt-1 text-sm text-muted">Thursday 12 October · 10:00</p>
                <Button type="button" className="mt-3 w-full">Confirm booking</Button>
              </Card>
              <p className="text-sm">
                Need to change it?{' '}
                <Button type="button" tone="text" size="tiny" className="h-auto p-0 align-baseline">
                  Reschedule
                </Button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cx(
            'rounded-md px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            value === key ? 'bg-selected text-foreground' : 'text-muted hover:bg-hover',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
