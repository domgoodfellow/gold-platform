'use client';

import { FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { useMemo } from 'react';

/**
 * Where a business is, and what it trades in.
 *
 * Both lists come from **ICU at runtime**, never from a table in this repository. That is not
 * laziness: a currency list checked into the application would be a second, staler answer to
 * a question the platform already has a source for, and a country-to-currency map would be
 * the platform deciding what a business trades in — which `constraints.md` forbids outright
 * ("Currency is per-tenant configuration and is never assumed").
 *
 * So the timezone is offered with the reader's own zone preselected, because where you are is
 * something the browser genuinely knows. The currency is offered with **nothing** preselected,
 * because no API knows what a business sells in and guessing from a country is exactly the
 * assumption being avoided — a Dutch company invoicing in dollars is ordinary.
 *
 * Where `Intl.supportedValuesOf` is missing, both degrade to a plain text input rather than to
 * an invented shortlist. An empty box asks the operator a question; a wrong shortlist answers
 * it for them.
 */

function supported(key: 'timeZone' | 'currency'): string[] | null {
  try {
    const values = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.(key);
    return values && values.length > 0 ? values : null;
  } catch {
    return null;
  }
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function TimeZoneField({
  defaultValue,
  label = 'Where is this business?',
}: {
  defaultValue?: string;
  label?: string;
}) {
  const zones = useMemo(() => supported('timeZone'), []);
  const current = defaultValue ?? browserTimeZone();

  return (
    <div className="flex flex-1 flex-col gap-1">
      <FieldLabel htmlFor="timezone">
        {label}
      </FieldLabel>
      {zones ? (
        <SelectInput id="timezone" name="timezone" defaultValue={current}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </SelectInput>
      ) : (
        <TextInput
          id="timezone"
          name="timezone"
          type="text"
          required
          defaultValue={current}
          placeholder="Europe/Amsterdam"
        />
      )}
      <Hint weight="subtle" className="text-xs">
        The clock your staff read. Every booking is stored as an absolute instant and shown in
        this zone.
      </Hint>
    </div>
  );
}

export function CurrencyField({ defaultValue }: { defaultValue?: string }) {
  const codes = useMemo(() => supported('currency'), []);

  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames(undefined, { type: 'currency' });
    } catch {
      return null;
    }
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-1">
      <FieldLabel htmlFor="currency">
        What does it trade in?
      </FieldLabel>
      {codes ? (
        <SelectInput id="currency" name="currency" required defaultValue={defaultValue ?? ''}>
          {/* No preselection when founding. There is no neutral currency, so the platform
              does not offer one — and deriving it from the timezone above would be the
              assumption this whole field exists to avoid. */}
          {defaultValue ? null : (
            <option value="" disabled>
              Choose a currency
            </option>
          )}
          {codes.map((code) => {
            const name = names?.of(code);
            return (
              <option key={code} value={code}>
                {name && name !== code ? `${code} — ${name}` : code}
              </option>
            );
          })}
        </SelectInput>
      ) : (
        <TextInput
          id="currency"
          name="currency"
          type="text"
          required
          maxLength={3}
          minLength={3}
          defaultValue={defaultValue}
          placeholder="EUR"
          className="uppercase"
        />
      )}
      <Hint weight="subtle" className="text-xs">
        Recorded on every amount as it is written, so changing this later never reinterprets
        what past work cost.
      </Hint>
    </div>
  );
}
