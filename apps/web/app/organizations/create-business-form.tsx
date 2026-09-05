'use client';

import { useActionState, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { createBusinessAction, type CreateBusinessState } from './actions';

const INITIAL: CreateBusinessState = { error: null };

/**
 * The first screen somebody who signed up actually meets.
 *
 * **It asks two questions.** Their name and the business's name — and nothing else, because
 * nothing else is needed to make the thing exist. That is the oldest rule in form design and
 * the one this screen was breaking: every field that can be derived elsewhere or collected
 * later is removed, and each field that stays costs you people who close the tab.
 *
 * What it used to ask was four things at once: a business name, a person's name, an IANA zone
 * chosen from a list of every zone on earth, and a currency — the last two sitting beside the
 * first two as though *what is your business called* and *what is your ISO 4217 code* were the
 * same kind of question to somebody who registered ninety seconds ago.
 *
 * - **The zone is derived, not asked.** The browser knows it. It is shown rather than hidden,
 *   because deriving something silently and being wrong is worse than asking, and one line with
 *   a Change link is not a question — nobody has to answer it to get through.
 * - **The currency is collected later.** It is needed the first time money is written down, so
 *   the pricing screen asks for it, in front of somebody already thinking about prices. It is
 *   still never guessed: `20260904000001` made "has not said" a state this platform can hold,
 *   precisely so that not asking here does not become the platform quietly answering.
 *
 * Everything else this business is — what it calls its work, its stages, its prices, its people
 * — is the next screen's business, and that screen is where this one sends them.
 */
export function CreateBusinessForm() {
  const [state, formAction, pending] = useActionState(createBusinessAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-6">
      {/* One column, and each label sits immediately above its field. Both are what the
          usability research settles rather than a house style: side-by-side fields break the
          vertical scan a form is read with, and a label anywhere but above is slower to
          complete and produces more errors. */}
      <Field
        name="displayName"
        label="What should we call you?"
        autoComplete="name"
        maxLength={120}
        autoFocus
      />

      <Field name="name" label="And what is the business called?" maxLength={200} />

      <TimeZoneChoice />

      {/* The button says what it does. "Create it" needs the sentence above it to be understood,
          and a button is read on its own by anybody scanning the page. */}
      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={pending} className="w-full sm:w-fit">
          {pending ? 'Creating…' : 'Create business'}
        </Button>
        <ErrorText role="alert">{state.error}</ErrorText>
      </div>
    </form>
  );
}

/**
 * A labelled text input.
 *
 * **No placeholder.** One that repeats the label disappears the moment somebody types and reads
 * as an already-filled field to anybody scanning back over the form; one that says something
 * *else* is instruction that vanishes exactly when it is needed. The label is the label.
 */
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
    // An environment that cannot resolve a zone keeps UTC, which is the absence of an
    // assumption rather than a guess at one.
    return 'UTC';
  }
}

/** Nothing changes the browser's zone mid-session, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

/**
 * The clock this business reads, worked out rather than asked for.
 *
 * **Resolved on the client, and the server does not guess.** `Intl` on the server reports the
 * *server's* zone, so resolving this during render would put one zone in the HTML and a
 * different one in the browser — and the person would watch it change without knowing why.
 *
 * The full list is still here and is one click away, because a business is not always in the
 * same place as the laptop signing it up. What changed is who has to deal with it: a founder in
 * Tallinn is told what was worked out, and only somebody it got wrong opens the list.
 */
function TimeZoneChoice() {
  // **`useSyncExternalStore` rather than an effect, and the rule that refused the effect was
  // right.** The zone is a value that exists outside React and differs between the server and
  // the browser, which is exactly the case this hook is for: the server snapshot is UTC, the
  // client snapshot is the real zone, and React reconciles the two itself instead of a
  // setState in an effect provoking a second render pass.
  const detected = useSyncExternalStore(noSubscribe, browserZone, () => 'UTC');

  // Null until somebody overrides it, so the detected zone stays live rather than being frozen
  // into state at first render — which is what would happen if this were seeded from it.
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const zone = chosen ?? detected;

  // `Intl.supportedValuesOf` is what the list comes from, never a table in this repository —
  // a checked-in list of zones is a second, staler answer to a question the platform already
  // has a source for. Where it is missing the picker is a text box: an empty box asks the
  // question honestly and an invented shortlist answers it wrongly.
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
