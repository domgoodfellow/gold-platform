'use client';

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  countryName,
  listCountries,
  listRegions,
  suggestRegionalDefaults,
  timeZoneLabel,
} from '@/lib/domain/tenancy/regional-defaults';

export type BusinessLocation = {
  countryCode: string;
  region: string;
  city: string;
  postalCode: string;
};

export const NO_LOCATION: BusinessLocation = { countryCode: '', region: '', city: '', postalCode: '' };

const subscribeNothing = () => () => {};

function useIsClient(): boolean {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function intlList(key: 'timeZone' | 'currency'): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(key) ?? [];
  } catch {
    return [];
  }
}

/**
 * Where the business is, and the clock and currency that follow from it.
 *
 * The location fields submit as `countryCode`, `region`, `city`, `postalCode`; the resolved
 * `timezone` and `currency` submit alongside. What the location *suggests* is a proposal: while
 * founding it is used until the person overrides it, and while editing a saved business it is only
 * offered — a business that moves its address is not silently moved onto another clock or
 * currency. A value the person chose is never replaced by a later suggestion.
 */
export function BusinessLocationFields({
  mode,
  initial = NO_LOCATION,
  initialTimeZone,
  initialCurrency,
  errors,
  streetFields,
}: {
  /** Rendered between the location fields and the regional-defaults summary: the street address, when the caller collects one. */
  streetFields?: ReactNode;
  mode: 'create' | 'edit';
  initial?: BusinessLocation;
  initialTimeZone?: string;
  initialCurrency?: string | null;
  errors?: Partial<Record<'country' | 'postal', string>>;
}) {
  const mounted = useIsClient();
  const [location, setLocation] = useState(initial);
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const browser = mounted ? browserZone() : undefined;
  const suggestion = useMemo(
    () => (location.countryCode ? suggestRegionalDefaults({ countryCode: location.countryCode, regionCode: location.region, browserTimeZone: browser }) : null),
    [location.countryCode, location.region, browser],
  );

  const baselineZone = mode === 'create' ? suggestion?.timeZone ?? browser ?? 'UTC' : initialTimeZone ?? 'UTC';
  const baselineCurrency = mode === 'create' ? suggestion?.currencyCode ?? '' : initialCurrency ?? '';
  const timeZone = zoneChoice ?? baselineZone;
  const currency = currencyChoice ?? baselineCurrency;

  const countries = useMemo(() => (mounted ? listCountries() : []), [mounted]);
  const regions = useMemo(() => listRegions(location.countryCode), [location.countryCode]);
  const zones = useMemo(() => (mounted ? intlList('timeZone') : []), [mounted]);
  const currencies = useMemo(() => (mounted ? intlList('currency') : []), [mounted]);
  const currencyNames = useMemo(() => {
    if (!mounted) return null;
    try {
      return new Intl.DisplayNames(undefined, { type: 'currency' });
    } catch {
      return null;
    }
  }, [mounted]);

  const set = (patch: Partial<BusinessLocation>) => setLocation((current) => ({ ...current, ...patch }));

  // In edit mode the location may now point somewhere other than the saved clock/currency. Offer, never apply.
  const proposesZone = mode === 'edit' && suggestion?.timeZone && suggestion.timeZone !== timeZone && zoneChoice === null;
  const proposesCurrency = mode === 'edit' && suggestion?.currencyCode && suggestion.currencyCode !== currency && currencyChoice === null && !initialCurrency;

  const place = [location.city, location.region && regions.find((r) => r.code === location.region)?.name || location.region, location.countryCode && countryName(location.countryCode)].filter(Boolean).join(', ');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="biz-country" label="Country" error={errors?.country}>
          {(field) => (
            <SelectInput {...field} className="w-full" name="countryCode" value={location.countryCode} onChange={(event) => set({ countryCode: event.target.value, region: '' })} required={mode === 'create'}>
              <option value="">Choose a country</option>
              {countries.length === 0 && location.countryCode ? <option value={location.countryCode}>{location.countryCode}</option> : null}
              {countries.map((country) => (
                <option key={country.code} value={country.code}>{country.name}</option>
              ))}
            </SelectInput>
          )}
        </FormField>

        <FormField id="biz-region" label={location.countryCode === 'CA' ? 'Province or territory' : location.countryCode === 'US' ? 'State' : 'State, province or region'} optional={regions.length === 0}>
          {(field) =>
            regions.length > 0 ? (
              <SelectInput {...field} className="w-full" name="region" value={location.region} onChange={(event) => set({ region: event.target.value })} required={mode === 'create'}>
                <option value="">Choose one</option>
                {regions.map((region) => (
                  <option key={region.code} value={region.code}>{region.name}</option>
                ))}
              </SelectInput>
            ) : (
              <TextInput {...field} name="region" value={location.region} maxLength={100} onChange={(event) => set({ region: event.target.value })} />
            )
          }
        </FormField>

        <FormField id="biz-city" label="City">
          {(field) => (
            <TextInput {...field} name="city" value={location.city} maxLength={100} required={mode === 'create'} onChange={(event) => set({ city: event.target.value })} />
          )}
        </FormField>

        <FormField id="biz-postal" label={location.countryCode === 'US' ? 'ZIP code' : 'Postal code'} optional error={errors?.postal}>
          {(field) => (
            <TextInput {...field} name="postalCode" value={location.postalCode} maxLength={20} autoComplete="postal-code" onChange={(event) => set({ postalCode: event.target.value })} />
          )}
        </FormField>
      </div>

      {streetFields}

      <input type="hidden" name="timezone" value={timeZone} />
      <input type="hidden" name="currency" value={currency} />

      {location.countryCode ? (
        <div className="rounded-lg border border-border bg-hover/40 p-4 text-sm" aria-live="polite">
          {!editing ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <p>
                {mode === 'create' ? <>Based in {place || countryName(location.countryCode)}. </> : <>Currently set to </>}
                {mode === 'create' ? "We'll use " : ''}
                <strong className="font-medium">{timeZoneLabel(timeZone)}</strong>
                {currency ? <> {mode === 'create' ? 'and suggest' : 'and'} <strong className="font-medium">{currency}</strong></> : <>. No currency chosen yet</>}
                .
              </p>
              <Button type="button" tone="text" size="small" onClick={() => setEditing(true)}>Edit</Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="biz-timezone" label="Time zone" hint="Schedules, opening hours and appointment times follow this.">
                {(field) => (
                  <SelectInput {...field} className="w-full" value={timeZone} onChange={(event) => setZoneChoice(event.target.value)}>
                    {zones.includes(timeZone) ? null : <option value={timeZone}>{timeZoneLabel(timeZone)}</option>}
                    {zones.map((zone) => (
                      <option key={zone} value={zone}>{timeZoneLabel(zone)}</option>
                    ))}
                  </SelectInput>
                )}
              </FormField>
              <FormField id="biz-currency" label="Currency" hint="What new prices and invoices use. Existing amounts keep the currency they were recorded in.">
                {(field) => (
                  <SelectInput {...field} className="w-full" value={currency} onChange={(event) => setCurrencyChoice(event.target.value)}>
                    {mode === 'create' || !initialCurrency ? <option value="">Decide later</option> : null}
                    {currency && !currencies.includes(currency) ? <option value={currency}>{currency}</option> : null}
                    {currencies.map((code) => {
                      const name = currencyNames?.of(code);
                      return <option key={code} value={code}>{name && name !== code ? `${code} — ${name}` : code}</option>;
                    })}
                  </SelectInput>
                )}
              </FormField>
              <div className="sm:col-span-2">
                <Button type="button" tone="text" size="small" onClick={() => setEditing(false)}>Done</Button>
              </div>
            </div>
          )}

          {proposesZone ? (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-3">
              <span>This location usually runs on {timeZoneLabel(suggestion!.timeZone!)}. Saved times stay exactly where they are; only how they are shown changes.</span>
              <Button type="button" tone="text" size="small" onClick={() => setZoneChoice(suggestion!.timeZone!)}>Use it</Button>
            </div>
          ) : null}
          {proposesCurrency ? (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-3">
              <span>Businesses here usually trade in {suggestion!.currencyCode}.</span>
              <Button type="button" tone="text" size="small" onClick={() => setCurrencyChoice(suggestion!.currencyCode!)}>Use it</Button>
            </div>
          ) : null}
          {suggestion?.requiresConfirmation ? (
            <Hint weight="subtle" className="mt-3">
              {suggestion.timeZone ? 'This place can span more than one time zone — check it before continuing.' : 'We could not work out a time zone from this location. Choose one with Edit.'}
            </Hint>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
