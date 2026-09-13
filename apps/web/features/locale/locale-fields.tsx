'use client';

import { FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { useMemo, useSyncExternalStore } from 'react';

/** Never changes after mount, so there is nothing to subscribe to — only the two snapshots
 * (server always false, client always true) matter. React's own escape hatch for a value that
 * is correctly different between the server render and the client one, without the effect/
 * setState round trip `react-hooks/set-state-in-effect` refuses. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

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

  // Names, not just the list, are ICU output — and ICU's own CLDR data genuinely differs
  // between Node's build (server render) and a browser's (hydration) for at least some
  // currencies ("BYN" alone renders "Belarusian Rouble" server-side and "Belarusian Ruble" in
  // Chromium on some paired versions), which React reports as a hydration mismatch and then
  // discards and re-renders the whole tree to recover from. The list of codes is stable across
  // both runtimes; only the display name is not. So the first render — server and the client's
  // first pass alike — shows codes alone, deterministic on both sides, and the name is filled
  // in only after mount, the same "client-only, once mounted" escape hatch Next's own hydration
  // guidance recommends for a value that cannot be the same on both renders.
  const mounted = useIsClient();

  const names = useMemo(() => {
    if (!mounted) return null;
    try {
      return new Intl.DisplayNames(undefined, { type: 'currency' });
    } catch {
      return null;
    }
  }, [mounted]);

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
