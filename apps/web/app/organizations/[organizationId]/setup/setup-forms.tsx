'use client';

import { Button } from '@/components/controls/button';
import { Card } from '@/components/containers/card';
import { EmptyState, SectionHeading } from '@/components/containers/section';
import { ErrorText, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { useActionState, useState } from 'react';
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  type Capability,
} from '@/lib/domain/tenancy/capabilities';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  FIELD_KINDS,
  FIELD_KIND_LABELS,
  type CustomFieldEntity,
  type FieldKind,
} from '@/lib/domain/fields/field-definitions';
import { TRIGGER_EVENTS } from '@/lib/domain/automation/rules';
import { MODULES, type ModuleKey } from '@/lib/navigation';
import { FONT_KEYS, FONT_LABELS } from '@/lib/domain/branding/palette';
import type { BusinessShape, ShapeField } from '@/lib/domain/configuration/configure';
import type { ConfigurationProposal } from '@/lib/domain/configuration/proposals';
import {
  applyAction,
  discardAction,
  proposeAction,
  reviseAction,
  type SetupActionState,
} from './actions';

const INITIAL: SetupActionState = { error: null };

/** ISO 8601, which is what `addOperatingHours` refuses anything else for. */
const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

function Error({ state }: { state: SetupActionState }) {
  if (!state.error) return null;
  return (
    <ErrorText role="alert" className="mt-1">
      {state.error}
    </ErrorText>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

/**
 * Describe the business, or answer what the last proposal asked.
 *
 * One box and nothing else. The alternative — a form with a field per thing the platform wants
 * to know — is the form this whole module exists to avoid: it asks a business to already know
 * what a status is before it can say what it does.
 */
export function DescribeForm({
  organizationId,
  refining,
  disabled,
}: {
  organizationId: string;
  refining: boolean;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(proposeAction, INITIAL);

  return (
    <form action={action} className="mt-4 max-w-2xl">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="refine" value={refining ? 'yes' : 'no'} />

      <label className="block text-sm" htmlFor="description">
        {refining
          ? 'Answer anything below, or say what to change. What you have already agreed to is kept.'
          : 'Describe the business in your own words — the work it does, how a job goes from start to finish, what you charge for, when you are open.'}
      </label>
      <TextArea
        id="description"
        name="description"
        rows={refining ? 4 : 8}
        required
        disabled={disabled}
        size="small"
        className="mt-2 w-full"
      />

      <Button
        type="submit"
        disabled={disabled || pending}
        tone="secondary"
        size="small"
        className="mt-2"
      >
        {pending ? 'Drafting…' : refining ? 'Redraft' : 'Draft a setup'}
      </Button>
      <Error state={state} />
    </form>
  );
}

/** A row of text inputs with a remove button, used by four of the lists below. */
function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <Button type="button" onClick={onRemove} tone="secondary" size="small">
        Remove
      </Button>
    </div>
  );
}

/**
 * The proposal, editable.
 *
 * **Editable is the point, not a convenience** (`constraints.md` D32). A review a person can
 * only accept or reject is an approval, and the argument D29 makes for the self-serve door is
 * that a proposal *edited* by the person who runs the business beats a form filled in by
 * somebody guessing. So every word here is theirs to change before anything is written.
 *
 * The whole shape is held in state and posted as JSON. That is the one place on this platform
 * where a form does that, and the reason is that this is not a row: it is a document whose
 * structure the domain layer owns, and naming its hundred parts as form fields would move that
 * ownership into a route.
 */
export function ProposalReview({
  organizationId,
  proposal,
}: {
  organizationId: string;
  proposal: ConfigurationProposal;
}) {
  const [shape, setShape] = useState<BusinessShape>(proposal.shape);
  const [saveState, save, saving] = useActionState(reviseAction, INITIAL);
  const [applyState, apply, applying] = useActionState(applyAction, INITIAL);
  const [discardState, discard, discarding] = useActionState(discardAction, INITIAL);

  const set = <K extends keyof BusinessShape>(key: K, value: BusinessShape[K]) =>
    setShape((current) => ({ ...current, [key]: value }));

  const fieldsFor = (entity: CustomFieldEntity): ShapeField[] => shape.fields[entity] ?? [];

  const setFields = (entity: CustomFieldEntity, next: ShapeField[]) =>
    set('fields', { ...shape.fields, [entity]: next });

  return (
    <div className="mt-6">
      {proposal.gaps.length > 0 && (
        <Card>
          <h3 className="text-sm font-medium">What this still needs from you</h3>
          {/* Rendered as written. The platform asked these questions and owns their words, but
              it does not answer them — an unfilled gap stays unfilled rather than being guessed
              at, which is the whole reason it is a question rather than a default. */}
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {proposal.gaps.map((gap, index) => (
              <li key={`${gap.field}-${index}`}>
                <span className="text-subtle">{gap.field}: </span>
                {gap.question}
              </li>
            ))}
          </ul>
          <Hint className="mt-2">
            Answer these in the box above and redraft, or fill them in below yourself.
          </Hint>
        </Card>
      )}

      {/* **First, because it is the only part of this proposal that changes what the business
          owns rather than how it is described** — and the part somebody must not apply without
          having read. Each one is switched on and paid for, so it is a list of checkboxes
          somebody clears rather than a summary they scroll past. A module already on stays on:
          applying never switches anything off. */}
      <Section title="What this switches on">
        <Hint>
          Each of these is part of your business once you apply this, and each one can be
          switched off again in Settings.
        </Hint>
        <div className="mt-2 space-y-2">
          {MODULES.map((module) => {
            const chosen = (shape.modules ?? []).includes(module.key);
            return (
              <label key={module.key} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={chosen}
                  onChange={(event) =>
                    set(
                      'modules',
                      event.target.checked
                        ? [...(shape.modules ?? []), module.key]
                        : (shape.modules ?? []).filter((key) => key !== module.key),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium">{module.label}</span>
                  <Hint>{module.description}</Hint>
                </span>
              </label>
            );
          })}
        </div>
      </Section>

      <Section title="What you call the work">
        <TextInput
          value={shape.typeName}
          aria-label="What you call the work"
          onChange={(event) => set('typeName', event.target.value)}
          size="small"
        />
      </Section>

      <Section title="How a job moves">
        {shape.statuses.map((status, index) => (
          <Row
            key={index}
            onRemove={() =>
              setShape((current) => ({
                ...current,
                statuses: current.statuses.filter((_, at) => at !== index),
                // A status leaving takes every move naming it, and every move above it shifts
                // down. Dropping only the status would leave transitions pointing at whatever
                // moved into that index — a legal-looking move nobody proposed.
                transitions: current.transitions
                  .filter(([from, to]) => from !== index && to !== index)
                  .map(([from, to]) => [
                    from > index ? from - 1 : from,
                    to > index ? to - 1 : to,
                  ]) as [number, number][],
                automations: (current.automations ?? [])
                  .filter((rule) => rule.moveTo !== index)
                  .map((rule) => ({
                    ...rule,
                    moveTo: rule.moveTo > index ? rule.moveTo - 1 : rule.moveTo,
                  })),
              }))
            }
          >
            <TextInput
              value={status}
              aria-label={`Stage ${index + 1}`}
              onChange={(event) =>
                set(
                  'statuses',
                  shape.statuses.map((entry, at) => (at === index ? event.target.value : entry)),
                )
              }
              size="small"
            />
          </Row>
        ))}
        <Button
          type="button"
          onClick={() => set('statuses', [...shape.statuses, ''])}
          tone="secondary"
          size="small"
        >
          Add a stage
        </Button>
      </Section>

      <Section title="Which moves are allowed">
        {/* A type with no moves is frozen rather than unconstrained (I13), so an empty list here
            is a real answer and the screen says which one it is. */}
        {shape.transitions.length === 0 && (
          <EmptyState>
            None yet, which means work cannot move between stages at all until you add some.
          </EmptyState>
        )}
        {shape.transitions.map(([from, to], index) => (
          <Row
            key={index}
            onRemove={() =>
              set(
                'transitions',
                shape.transitions.filter((_, at) => at !== index),
              )
            }
          >
            {([['from', from], ['to', to]] as const).map(([which, value]) => (
              <SelectInput
                key={which}
                value={value}
                aria-label={`Move ${index + 1} ${which}`}
                onChange={(event) =>
                  set(
                    'transitions',
                    shape.transitions.map((pair, at) =>
                      at === index
                        ? which === 'from'
                          ? [Number(event.target.value), pair[1]]
                          : [pair[0], Number(event.target.value)]
                        : pair,
                    ) as [number, number][],
                  )
                }
                size="small"
              >
                {shape.statuses.map((status, at) => (
                  <option key={at} value={at}>
                    {status || `Stage ${at + 1}`}
                  </option>
                ))}
              </SelectInput>
            ))}
          </Row>
        ))}
        <Button
          type="button"
          disabled={shape.statuses.length < 2}
          onClick={() => set('transitions', [...shape.transitions, [0, 1]])}
          tone="secondary"
          size="small"
        >
          Add a move
        </Button>
      </Section>

      <Section title="What you charge for">
        {shape.prices.map((price, index) => (
          <Row
            key={index}
            onRemove={() =>
              set(
                'prices',
                shape.prices.filter((_, at) => at !== index),
              )
            }
          >
            <TextInput
              value={price.name}
              aria-label={`Item ${index + 1} name`}
              onChange={(event) =>
                set(
                  'prices',
                  shape.prices.map((entry, at) =>
                    at === index ? { ...entry, name: event.target.value } : entry,
                  ),
                )
              }
              size="small"
            />
            <TextInput
              value={price.unit}
              aria-label={`Item ${index + 1} unit`}
              placeholder="hour, visit, each"
              onChange={(event) =>
                set(
                  'prices',
                  shape.prices.map((entry, at) =>
                    at === index ? { ...entry, unit: event.target.value } : entry,
                  ),
                )
              }
              size="small"
            />
            {/* Minor units, uncomverted and undivided (I10). The label says so rather than the
                screen guessing at a decimal point that means nothing in a currency without one. */}
            <TextInput
              type="number"
              value={price.amountMinor}
              aria-label={`Item ${index + 1} amount in minor units`}
              onChange={(event) =>
                set(
                  'prices',
                  shape.prices.map((entry, at) =>
                    at === index ? { ...entry, amountMinor: Number(event.target.value) } : entry,
                  ),
                )
              }
              size="small"
            />
          </Row>
        ))}
        <Button
          type="button"
          onClick={() =>
            set('prices', [...shape.prices, { name: '', unit: '', amountMinor: 0 }])
          }
          tone="secondary"
          size="small"
        >
          Add something you charge for
        </Button>
      </Section>

      <Section title="When you are open">
        {shape.hours.length === 0 && (
          <EmptyState>
            Nothing set, which is treated as always open. Nothing here assumes a working week.
          </EmptyState>
        )}
        {shape.hours.map((entry, index) => (
          <Row
            key={index}
            onRemove={() =>
              set(
                'hours',
                shape.hours.filter((_, at) => at !== index),
              )
            }
          >
            <SelectInput
              value={entry.dayOfWeek}
              aria-label={`Opening ${index + 1} day`}
              onChange={(event) =>
                set(
                  'hours',
                  shape.hours.map((row, at) =>
                    at === index ? { ...row, dayOfWeek: Number(event.target.value) } : row,
                  ),
                )
              }
              size="small"
            >
              {DAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </SelectInput>
            {(['opensAt', 'closesAt'] as const).map((which) => (
              <TextInput
                key={which}
                type="time"
                value={entry[which].slice(0, 5)}
                aria-label={`Opening ${index + 1} ${which === 'opensAt' ? 'from' : 'until'}`}
                onChange={(event) =>
                  set(
                    'hours',
                    shape.hours.map((row, at) =>
                      at === index ? { ...row, [which]: event.target.value } : row,
                    ),
                  )
                }
                size="small"
              />
            ))}
          </Row>
        ))}
        <Button
          type="button"
          onClick={() =>
            set('hours', [...shape.hours, { dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }])
          }
          tone="secondary"
          size="small"
        >
          Add a day
        </Button>
      </Section>

      <Section title="Roles besides your own">
        {shape.roles.map((role, index) => (
          <div key={index} className="rounded border border-border p-2">
            <Row
              onRemove={() =>
                set(
                  'roles',
                  shape.roles.filter((_, at) => at !== index),
                )
              }
            >
              <TextInput
                value={role.name}
                aria-label={`Role ${index + 1} name`}
                onChange={(event) =>
                  set(
                    'roles',
                    shape.roles.map((entry, at) =>
                      at === index ? { ...entry, name: event.target.value } : entry,
                    ),
                  )
                }
                size="small"
              />
            </Row>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {CAPABILITIES.map((capability) => (
                <label key={capability} className="text-sm">
                  <input
                    type="checkbox"
                    className="mr-1"
                    checked={role.capabilities.includes(capability)}
                    onChange={(event) =>
                      set(
                        'roles',
                        shape.roles.map((entry, at) =>
                          at === index
                            ? {
                                ...entry,
                                capabilities: event.target.checked
                                  ? [...entry.capabilities, capability]
                                  : entry.capabilities.filter((held) => held !== capability),
                              }
                            : entry,
                        ),
                      )
                    }
                  />
                  {CAPABILITY_LABELS[capability as Capability]}
                </label>
              ))}
            </div>
          </div>
        ))}
        <Button
          type="button"
          onClick={() => set('roles', [...shape.roles, { name: '', capabilities: [] }])}
          tone="secondary"
          size="small"
        >
          Add a role
        </Button>
      </Section>

      <Section title="What else you record">
        {CUSTOM_FIELD_ENTITIES.map((entity) => (
          <div key={entity}>
            <Hint>{CUSTOM_FIELD_ENTITY_LABELS[entity]}</Hint>
            {fieldsFor(entity).map((field, index) => (
              <Row
                key={index}
                onRemove={() =>
                  setFields(
                    entity,
                    fieldsFor(entity).filter((_, at) => at !== index),
                  )
                }
              >
                <TextInput
                  value={field.label}
                  aria-label={`${entity} field ${index + 1} label`}
                  onChange={(event) =>
                    setFields(
                      entity,
                      fieldsFor(entity).map((entry, at) =>
                        at === index ? { ...entry, label: event.target.value } : entry,
                      ),
                    )
                  }
                  size="small"
                />
                {/* `key` and `kind` are shown and not editable, because they are not editable by
                    anyone through any path once written — the column grant refuses them. Letting
                    somebody change one here would be a form that works until it is applied. */}
                <span className="text-sm text-subtle">
                  {field.key} · {FIELD_KIND_LABELS[field.kind as FieldKind]}
                </span>
                <label className="text-sm">
                  <input
                    type="checkbox"
                    className="mr-1"
                    checked={field.required}
                    onChange={(event) =>
                      setFields(
                        entity,
                        fieldsFor(entity).map((entry, at) =>
                          at === index ? { ...entry, required: event.target.checked } : entry,
                        ),
                      )
                    }
                  />
                  Required
                </label>
              </Row>
            ))}
            <Button
              type="button"
              onClick={() =>
                setFields(entity, [
                  ...fieldsFor(entity),
                  {
                    key: `field_${fieldsFor(entity).length + 1}`,
                    label: '',
                    kind: FIELD_KINDS[0],
                    required: false,
                  },
                ])
              }
              tone="secondary"
              size="small"
              className="mt-1"
            >
              Add to {CUSTOM_FIELD_ENTITY_LABELS[entity].toLowerCase()}
            </Button>
          </div>
        ))}
      </Section>

      <Section title="What happens on its own">
        {(shape.automations ?? []).map((rule, index) => (
          <Row
            key={index}
            onRemove={() =>
              set(
                'automations',
                (shape.automations ?? []).filter((_, at) => at !== index),
              )
            }
          >
            <TextInput
              value={rule.name}
              aria-label={`Rule ${index + 1} name`}
              onChange={(event) =>
                set(
                  'automations',
                  (shape.automations ?? []).map((entry, at) =>
                    at === index ? { ...entry, name: event.target.value } : entry,
                  ),
                )
              }
              size="small"
            />
            <SelectInput
              value={rule.on}
              aria-label={`Rule ${index + 1} trigger`}
              onChange={(event) =>
                set(
                  'automations',
                  (shape.automations ?? []).map((entry, at) =>
                    at === index ? { ...entry, on: event.target.value } : entry,
                  ),
                )
              }
              size="small"
            >
              {TRIGGER_EVENTS.map((event) => (
                <option key={event.action} value={event.action}>
                  When {event.label}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              value={rule.moveTo}
              aria-label={`Rule ${index + 1} destination`}
              onChange={(event) =>
                set(
                  'automations',
                  (shape.automations ?? []).map((entry, at) =>
                    at === index ? { ...entry, moveTo: Number(event.target.value) } : entry,
                  ),
                )
              }
              size="small"
            >
              {shape.statuses.map((status, at) => (
                <option key={at} value={at}>
                  move it to {status || `Stage ${at + 1}`}
                </option>
              ))}
            </SelectInput>
          </Row>
        ))}
        <Button
          type="button"
          disabled={shape.statuses.length === 0}
          onClick={() =>
            set('automations', [
              ...(shape.automations ?? []),
              { name: '', on: TRIGGER_EVENTS[0].action, moveTo: 0 },
            ])
          }
          tone="secondary"
          size="small"
        >
          Add a rule
        </Button>
      </Section>

      {/* **The two parts of a proposal that are about how the business appears rather than how
          it works**, and they are last on purpose: somebody reviewing a setup is deciding
          whether the stages and the prices are right, and a colour picker above that would be
          the least consequential thing on the screen sitting at the top of it. */}
      <Section title="What you say about yourself">
        <Hint weight="subtle">
          Shown to customers on your public page, above anything else. Yours to write — the
          platform adds nothing to it, and leaving it empty shows your name and nothing else.
        </Hint>
        <TextInput
          value={shape.voice?.tagline ?? ''}
          aria-label="Tagline"
          placeholder="One line under your name"
          onChange={(event) =>
            set('voice', {
              tagline: event.target.value,
              intro: shape.voice?.intro ?? '',
            })
          }
          size="small"
          className="w-full"
        />
        <TextArea
          value={shape.voice?.intro ?? ''}
          aria-label="Introduction"
          rows={3}
          placeholder="A short paragraph a customer reads before booking"
          onChange={(event) =>
            set('voice', {
              tagline: shape.voice?.tagline ?? '',
              intro: event.target.value,
            })
          }
          size="small"
          className="w-full"
        />
      </Section>

      <Section title="How it looks">
        <Hint weight="subtle">
          Your colour is used for buttons and links, on these screens and on your public page.
          Everything else stays as it is, and the colour is darkened automatically wherever it
          would be hard to read — so nothing you choose here can make your own screens
          illegible.
        </Hint>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label="Your colour"
            value={shape.brand?.accent || '#000000'}
            onChange={(event) =>
              set('brand', {
                accent: event.target.value,
                headingFont: shape.brand?.headingFont ?? 'sans',
                bodyFont: shape.brand?.bodyFont ?? 'sans',
              })
            }
            className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
          />
          <TextInput
            value={shape.brand?.accent ?? ''}
            aria-label="Your colour, as a hex value"
            placeholder="#1f6feb"
            maxLength={7}
            onChange={(event) =>
              set('brand', {
                accent: event.target.value,
                headingFont: shape.brand?.headingFont ?? 'sans',
                bodyFont: shape.brand?.bodyFont ?? 'sans',
              })
            }
            size="small"
            className="w-28 font-mono"
          />
          <SelectInput
            value={shape.brand?.headingFont ?? 'sans'}
            aria-label="Heading lettering"
            onChange={(event) =>
              set('brand', {
                accent: shape.brand?.accent ?? '',
                headingFont: event.target.value,
                bodyFont: shape.brand?.bodyFont ?? 'sans',
              })
            }
            size="small"
          >
            {FONT_KEYS.map((key) => (
              <option key={key} value={key}>
                Headings: {FONT_LABELS[key]}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            value={shape.brand?.bodyFont ?? 'sans'}
            aria-label="Body lettering"
            onChange={(event) =>
              set('brand', {
                accent: shape.brand?.accent ?? '',
                headingFont: shape.brand?.headingFont ?? 'sans',
                bodyFont: event.target.value,
              })
            }
            size="small"
          >
            {FONT_KEYS.map((key) => (
              <option key={key} value={key}>
                Text: {FONT_LABELS[key]}
              </option>
            ))}
          </SelectInput>
        </div>
      </Section>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <form action={save}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="shape" value={JSON.stringify(shape)} />
          <Button type="submit" disabled={saving} tone="secondary" size="small">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </form>

        <form action={apply}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <Button type="submit" disabled={applying} tone="secondary" size="small">
            {applying ? 'Applying…' : 'Apply this setup'}
          </Button>
        </form>

        <form action={discard}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <Button type="submit" disabled={discarding} tone="secondary" size="small">
            Discard
          </Button>
        </form>
      </div>

      {/* Save first, then apply — said out loud because the two buttons sit together and a
          person who edited and pressed Apply would otherwise apply what they started with. */}
      <Hint className="mt-2">
        Applying uses the last saved version. Save your changes first if you have made any.
      </Hint>

      <Error state={saveState} />
      <Error state={applyState} />
      <Error state={discardState} />
    </div>
  );
}

/**
 * What has been proposed before, and what happened to it.
 *
 * A failed apply is the row that earns this section. `configureBusiness` is not atomic, so a
 * failure leaves a business part-way configured — and the honest thing is to say which step
 * refused, in the words the database or the domain layer used, beside what the business turned
 * out to have afterwards.
 */
export function ProposalHistory({ proposals }: { proposals: ConfigurationProposal[] }) {
  if (proposals.length === 0) return null;

  return (
    <section className="mt-10 border-t border-border pt-4">
      <SectionHeading>What has been proposed before</SectionHeading>
      <ul className="mt-2 space-y-3">
        {proposals.map((proposal) => (
          <li key={proposal.id} className="text-sm">
            <span className="text-subtle">
              {new Date(proposal.createdAt).toLocaleString()} · {proposal.outcome} · drafted by{' '}
              {proposal.draftedBy}
            </span>
            <p className="mt-1 max-w-2xl whitespace-pre-wrap opacity-80">{proposal.description}</p>
            {proposal.detail && (
              <ErrorText className="mt-1 max-w-2xl">
                Stopped part-way: {proposal.detail}
              </ErrorText>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
