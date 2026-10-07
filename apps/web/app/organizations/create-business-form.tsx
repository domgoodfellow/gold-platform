'use client';

import { useActionState, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { createBusinessAction, type CreateBusinessState } from './actions';

const INITIAL: CreateBusinessState = { error: null };

/** Account identity is collected at signup; this screen creates the business and its timezone. */
export function CreateBusinessForm() {
  const [state, formAction, pending] = useActionState(createBusinessAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-6">
      <Field name="name" label="What is the business called?" maxLength={200} autoFocus />

      <TimeZoneChoice />

      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={pending} className="w-full sm:w-fit">
          {pending ? 'Creating…' : 'Create business'}
        </Button>
        <ErrorText role="alert">{state.error}</ErrorText>
      </div>
    </form>
  );
}

/** No placeholder — one that repeats the label disappears once typed; one that says something else vanishes exactly when needed. */
function Field({
  name,
  label,
  ...rest
}: { name: string; label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <TextInput id={name} name={name} type="text" required className="w-full" {...rest} />
    </div>
  );
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Nothing changes the browser's zone mid-session, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

/**
 * The clock this business reads, worked out rather than asked for. Resolved on the client only —
 * `Intl` on the server reports the server's own zone, so resolving during render would flash one
 * zone in the HTML and a different one in the browser. `useSyncExternalStore` rather than an
 * effect: the server snapshot is UTC, the client snapshot is the real zone, and React reconciles
 * the two itself instead of a second render pass from `setState` in an effect.
 */
function TimeZoneChoice() {
  const detected = useSyncExternalStore(noSubscribe, browserZone, () => 'UTC');

  // Null until overridden, so the detected zone stays live rather than freezing into state at first render.
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const zone = chosen ?? detected;

  // `Intl.supportedValuesOf` is the source, never a checked-in list — a stale table would be a second, worse answer to a question the platform already has.
  const zones = useMemo(() => {
    try {
      const values = (
        Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
      ).supportedValuesOf?.('timeZone');
      return values && values.length > 0 ? values : null;
    } catch {
      return null;
    }
  }, []);

  if (picking) {
    return (
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="timezone">Which clock should this business read?</FieldLabel>
        {zones ? (
          <SelectInput
            id="timezone"
            name="timezone"
            defaultValue={zone}
            className="w-full"
            onChange={(event) => setChosen(event.target.value)}
          >
            {zones.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </SelectInput>
        ) : (
          <TextInput
            id="timezone"
            name="timezone"
            type="text"
            required
            defaultValue={zone}
            className="w-full"
            onChange={(event) => setChosen(event.target.value)}
          />
        )}
        <Hint weight="subtle">
          Times are stored as exact instants, so changing this later moves nothing.
        </Hint>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted">
      <input type="hidden" name="timezone" value={zone} />
      <span>Times will show in {zone.replace(/_/g, ' ')}.</span>
      <Button type="button" tone="text" size="small" onClick={() => setPicking(true)}>
        Change
      </Button>
    </div>
  );
}
