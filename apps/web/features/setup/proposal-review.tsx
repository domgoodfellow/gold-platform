'use client';

import { Button } from '@/components/controls/button';
import { Card } from '@/components/surfaces/card';
import { EmptyState } from '@/components/surfaces/section';
import { Hint, TextArea, TextInput } from '@/components/controls/inputs';
import { useActionState, useEffect, useState } from 'react';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
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
import { MODULES } from '@/lib/navigation';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import type { CatalogFeature } from '@/lib/domain/catalogue/catalogue';
import { FONT_KEYS, FONT_LABELS } from '@/lib/domain/branding/palette';
import { RESOURCE_CLASSES, RESOURCE_CLASS_LABELS, type ResourceClass } from '@/lib/domain/resources/resource-class';
import { BUSINESS_NOUNS, type BusinessEntity } from '@/lib/domain/tenancy/business-profile';
import type { BusinessShape, ShapeField, ShapeRequirement, ShapeStage, ShapeWorkType } from '@/lib/domain/configuration/configure';
import type { ConfigurationProposal, IndustryTemplate } from '@/lib/domain/configuration/proposals';
import {
  applyAction,
  deferAction,
  discardAction,
  reviseAction,
  startAction,
  type SetupActionState,
} from '@/app/organizations/[organizationId]/setup/actions';
import { Error, Section } from './setup-controls';
import { SelectField } from '@/components/controls/select-field';
import { SelectableCard } from '@/components/controls/selectable-card';
import { COPY_PREFIX } from '@/lib/domain/configuration/shape';

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

/** The tabs of the review, in plain words. */
const DOMAINS = [
  { key: 'operations', label: 'Work' },
  { key: 'customers', label: 'Customers' },
  { key: 'words', label: 'Words' },
  { key: 'finance', label: 'Prices' },
  { key: 'people', label: 'Team' },
  { key: 'data', label: 'Records' },
  { key: 'automations', label: 'Rules' },
  { key: 'presence', label: 'Public page' },
  { key: 'features', label: 'Features' },
] as const;

/** Nouns a starting setup most often renames; any other the document names is shown too. */
const COMMON_NOUNS: BusinessEntity[] = ['customer', 'work'];

/**
 * The proposal, editable.
 *
 * **Editable is the point, not a convenience** (the draft-then-apply rule, ADR-039). A review a person can
 * only accept or reject is an approval, and the argument the one-creation-path rule makes for the self-serve door is
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
  featureStates = [],
  features = [],
}: {
  organizationId: string;
  proposal: ConfigurationProposal;
  featureStates?: ResolvedFeatureState[];
  features?: CatalogFeature[];
}) {
  const [shape, setShape] = useState<BusinessShape>(proposal.shape);
  const [domain, setDomain] = useState('operations');
  const [savedShape, setSavedShape] = useState(JSON.stringify(proposal.shape));
  const [saveState, save, saving] = useActionState(async (previous: SetupActionState, data: FormData) => {
    const result = await reviseAction(previous, data);
    if (!result.error) setSavedShape(String(data.get('shape')));
    return result;
  }, INITIAL);
  const [applyState, apply, applying] = useActionState(applyAction, INITIAL);
  const [discardState, discard, discarding] = useActionState(discardAction, INITIAL);
  const [laterState, later, deferring] = useActionState(deferAction, INITIAL);
  const dirty = JSON.stringify(shape) !== savedShape;
  const pending = saving || applying || discarding || deferring;
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const set = <K extends keyof BusinessShape>(key: K, value: BusinessShape[K]) =>
    setShape((current) => ({ ...current, [key]: value }));

  const workTypes = shape.workTypes ?? [];
  const setWorkTypes = (next: ShapeWorkType[]) => set('workTypes', next);
  const setType = (index: number, patch: Partial<ShapeWorkType>) =>
    setWorkTypes(workTypes.map((type, at) => (at === index ? { ...type, ...patch } : type)));
  const setStage = (typeIndex: number, index: number, patch: Partial<ShapeStage>) =>
    setType(typeIndex, { stages: workTypes[typeIndex].stages.map((stage, at) => (at === index ? { ...stage, ...patch } : stage)) });
  const setNeed = (typeIndex: number, index: number, patch: Partial<ShapeRequirement>) =>
    setType(typeIndex, { requirements: (workTypes[typeIndex].requirements ?? []).map((need, at) => (at === index ? { ...need, ...patch } : need)) });
  const stageOptions = (type: ShapeWorkType) => type.stages.map((stage, at) => ({ value: String(at), label: stage.name || `Stage ${at + 1}` }));
  // A stage leaving takes every move and rule naming it, and every index above it shifts down.
  // Dropping only the stage would leave moves pointing at whatever moved into that index.
  const removeStage = (typeIndex: number, index: number) => {
    const type = workTypes[typeIndex];
    const shift = (at: number) => (at > index ? at - 1 : at);
    setType(typeIndex, {
      stages: type.stages.filter((_, at) => at !== index),
      transitions: type.transitions.filter(([from, to]) => from !== index && to !== index).map(([from, to]) => [shift(from), shift(to)]) as [number, number][],
      automations: type.automations?.filter((rule) => rule.moveTo !== index).map((rule) => ({ ...rule, moveTo: shift(rule.moveTo) })),
      booking: type.booking && type.booking.stage !== index ? { ...type.booking, stage: shift(type.booking.stage) } : undefined,
    });
  };
  const nouns = shape.wording?.nouns ?? {};
  const shownNouns = [...new Set([...COMMON_NOUNS, ...(Object.keys(nouns) as BusinessEntity[])])];
  const setNoun = (entity: BusinessEntity, form: 'singular' | 'plural', value: string) => {
    const current = nouns[entity] ?? { singular: '', plural: '' };
    const next = { ...current, [form]: value };
    const rest = { ...nouns };
    delete rest[entity];
    set('wording', { ...shape.wording, nouns: next.singular || next.plural ? { ...rest, [entity]: next } : rest });
  };
  const portalForms = shape.portal?.forms ?? [];

  const fieldEditor = (entity: CustomFieldEntity, labelled = true) => (
    <div key={entity}>
            {labelled ? <Hint>{CUSTOM_FIELD_ENTITY_LABELS[entity]}</Hint> : null}
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
  );

  const fieldsFor = (entity: CustomFieldEntity): ShapeField[] => shape.fields[entity] ?? [];

  const setFields = (entity: CustomFieldEntity, next: ShapeField[]) =>
    set('fields', { ...shape.fields, [entity]: next });

  return (
    <div className="mt-6">
      <div role="group" aria-label="Parts of this setup" className="flex flex-wrap gap-1">
          {DOMAINS.map(({ key, label }) =>
            <Button key={key} type="button" tone={domain === key ? 'primary' : 'secondary'} size="small" aria-pressed={domain === key} onClick={() => setDomain(key)}>{label}</Button>)}
      </div>
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
            Review these questions and fill in the relevant fields before applying.
          </Hint>
        </Card>
      )}

      {/* **First, because it is the only part of this proposal that changes what the business
          owns rather than how it is described** — and the part somebody must not apply without
          having read. Included features can be activated, so it is a list of checkboxes
          somebody clears rather than a summary they scroll past. A module already on stays on:
          applying never switches anything off. */}
      <Section title="What this switches on" hidden={domain !== 'features'}>
        <Hint>
          Only features in your plan can be switched on. Applying never buys anything.
        </Hint>
        <div className="mt-2 space-y-2">
          {features.map((feature) => {
            const state = featureStates.find((candidate) => candidate.featureId === feature.id);
            const included = state?.entitled && state.implementationState === 'available';
            const chosen = (shape.featureKeys ?? []).includes(feature.key);
            if (!included && !chosen) return null;
            return (
              <label key={feature.id} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={chosen}
                  disabled={!included && !chosen}
                  onChange={(event) =>
                    set(
                      'featureKeys',
                      event.target.checked
                        ? [...(shape.featureKeys ?? []), feature.key]
                        : (shape.featureKeys ?? []).filter((key) => key !== feature.key),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium">{feature.label}</span>
                  {!included ? <Hint>Not in your plan. Remove it before applying.</Hint> : <Hint>In your plan</Hint>}
                  <Hint>{feature.description}</Hint>
                </span>
              </label>
            );
          })}
          {(shape.modules ?? []).map((key) => {
            const inPlan = featureStates.some((state) => state.moduleKey === key && state.entitled && state.implementationState === 'available');
            return <Row key={key} onRemove={() => set('modules', (shape.modules ?? []).filter((candidate) => candidate !== key))}>
              <span className="text-sm">
                {MODULES.find((module) => module.key === key)?.label ?? key}
                {/* A starting setup leaves out what the plan does not include; a drafted one is refused. */}
                {inPlan ? null : <Hint>{proposal.origin === 'drafted' ? 'Not in your plan. Remove it before applying.' : 'Not in your plan, so it will be left out.'}</Hint>}
              </span>
            </Row>;
          })}
        </div>
      </Section>

      <Section title="Kinds of work" hidden={domain !== 'operations'}>
        {workTypes.map((type, typeIndex) => (
          <Card key={typeIndex} className="space-y-3">
            <Row onRemove={() => setWorkTypes(workTypes.filter((_, at) => at !== typeIndex))}>
              <TextInput
                value={type.name}
                aria-label={`Kind of work ${typeIndex + 1} name`} className="sm:w-72"
                onChange={(event) => setType(typeIndex, { name: event.target.value })}
                size="small"
              />
            </Row>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={type.schedulable}
                onChange={(event) => setType(typeIndex, event.target.checked
                  ? { schedulable: true }
                  : { schedulable: false, booking: undefined, requirements: undefined })}
              />
              Happens at a set time and appears in Schedule
            </label>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Stages</h4>
              {type.stages.map((stage, index) => (
                <Row key={index} onRemove={() => removeStage(typeIndex, index)}>
                  <TextInput
                    value={stage.name}
                    aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} stage ${index + 1}`} className="sm:w-72"
                    onChange={(event) => setStage(typeIndex, index, { name: event.target.value })}
                    size="small"
                  />
                  <label className="text-sm">
                    <input type="checkbox" className="mr-1" checked={stage.marksComplete ?? false}
                      onChange={(event) => setStage(typeIndex, index, { marksComplete: event.target.checked })} />
                    Counts as done
                  </label>
                  <label className="text-sm">
                    <input type="checkbox" className="mr-1" checked={stage.releasesResource ?? false}
                      onChange={(event) => setStage(typeIndex, index, { releasesResource: event.target.checked })} />
                    Frees the people and equipment
                  </label>
                </Row>
              ))}
              <Button type="button" onClick={() => setType(typeIndex, { stages: [...type.stages, { name: '' }] })} tone="secondary" size="small">
                Add a stage
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Which moves are allowed</h4>
              {/* A kind of work with no moves is frozen rather than unconstrained, so an empty list here is a real answer. */}
              {type.transitions.length === 0 && type.stages.length > 1 ? (
                <Hint>None yet, so work cannot move between stages until you add some.</Hint>
              ) : null}
              {type.transitions.map(([from, to], index) => (
                <Row key={index} onRemove={() => setType(typeIndex, { transitions: type.transitions.filter((_, at) => at !== index) })}>
                  {([['from', from], ['to', to]] as const).map(([which, value]) => (
                    <SelectField key={which} value={String(value)} aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} move ${index + 1} ${which}`}
                      onValueChange={(next) => setType(typeIndex, {
                        transitions: type.transitions.map((pair, at) => at === index
                          ? which === 'from' ? [Number(next), pair[1]] : [pair[0], Number(next)]
                          : pair) as [number, number][],
                      })}
                      size="small" options={stageOptions(type)} />
                  ))}
                </Row>
              ))}
              <Button type="button" disabled={type.stages.length < 2} onClick={() => setType(typeIndex, { transitions: [...type.transitions, [0, 1]] })} tone="secondary" size="small">
                Add a move
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Steps on each job</h4>
              {(type.checklist ?? []).map((step, index) => (
                <Row key={index} onRemove={() => setType(typeIndex, { checklist: (type.checklist ?? []).filter((_, at) => at !== index) })}>
                  <TextInput value={step} aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} step ${index + 1}`} size="small" className="sm:w-72"
                    onChange={(event) => setType(typeIndex, { checklist: (type.checklist ?? []).map((entry, at) => at === index ? event.target.value : entry) })} />
                </Row>
              ))}
              <Button type="button" onClick={() => setType(typeIndex, { checklist: [...(type.checklist ?? []), ''] })} tone="secondary" size="small">
                Add a step
              </Button>
            </div>

            {type.schedulable ? (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">What each job needs</h4>
                {(type.requirements ?? []).map((need, index) => (
                  <Row key={index} onRemove={() => setType(typeIndex, { requirements: (type.requirements ?? []).filter((_, at) => at !== index) })}>
                    <TextInput type="number" min={1} max={50} value={need.quantity} size="small" className="w-20"
                      aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} need ${index + 1} how many`}
                      onChange={(event) => setNeed(typeIndex, index, { quantity: Number(event.target.value) })} />
                    <SelectField value={need.resourceClass} size="small" aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} need ${index + 1} kind`}
                      onValueChange={(next) => setNeed(typeIndex, index, { resourceClass: next as ResourceClass })}
                      options={RESOURCE_CLASSES.map((resourceClass) => ({ value: resourceClass, label: RESOURCE_CLASS_LABELS[resourceClass] }))} />
                    <TextInput value={(need.capabilities ?? []).join(', ')} size="small" placeholder="Able to (optional)" className="sm:w-56"
                      aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} need ${index + 1} able to`}
                      onChange={(event) => setNeed(typeIndex, index, { capabilities: event.target.value.split(',').map((word) => word.trim()).filter(Boolean) })} />
                  </Row>
                ))}
                <Button type="button" onClick={() => setType(typeIndex, { requirements: [...(type.requirements ?? []), { resourceClass: 'person', quantity: 1 }] })} tone="secondary" size="small">
                  Add a need
                </Button>

                <h4 className="text-sm font-medium">Online booking</h4>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(type.booking)} disabled={type.stages.length === 0}
                    onChange={(event) => setType(typeIndex, { booking: event.target.checked ? { stage: 0, durationMinutes: 60 } : undefined })} />
                  Customers can book this online
                </label>
                {type.booking ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <SelectField value={String(type.booking.stage)} size="small" aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} bookings arrive in`}
                      onValueChange={(next) => setType(typeIndex, { booking: { ...type.booking!, stage: Number(next) } })}
                      options={stageOptions(type).map((option) => ({ ...option, label: `Arrives in ${option.label}` }))} />
                    <TextInput type="number" min={5} max={1440} value={type.booking.durationMinutes} size="small" className="w-24"
                      aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} booking length in minutes`}
                      onChange={(event) => setType(typeIndex, { booking: { ...type.booking!, durationMinutes: Number(event.target.value) } })} />
                    <span className="text-sm text-muted">minutes</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))}
        <Button type="button" onClick={() => setWorkTypes([...workTypes, { name: '', schedulable: false, stages: [{ name: '' }], transitions: [] }])} tone="secondary" size="small">
          Add a kind of work
        </Button>
      </Section>

      <Section title="What you charge for" hidden={domain !== 'finance'}>
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
            {/* Minor units, uncomverted and undivided. The label says so rather than the
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

      <Section title="When you are open" hidden={domain !== 'operations'}>
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
            <SelectField value={String(entry.dayOfWeek)} aria-label={`Opening ${index + 1} day`} onValueChange={(next) => set(
                  'hours',
                  shape.hours.map((row, at) =>
                    at === index ? { ...row, dayOfWeek: Number(next) } : row,
                  ),
                )} size="small" options={[...DAYS.map((day) => ({ value: String(day.value), label: day.label }))]} />
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

      <Section title="Roles besides your own" hidden={domain !== 'people'}>
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

      <Section title="What else you record" hidden={domain !== 'data'}>
        {CUSTOM_FIELD_ENTITIES.filter((entity) => entity !== 'customer').map((entity) => fieldEditor(entity))}
      </Section>

      <Section title="What happens on its own" hidden={domain !== 'automations'}>
        {workTypes.map((type, typeIndex) => (
          <div key={typeIndex} className="space-y-2">
            <h4 className="text-sm font-medium">{type.name || `Kind of work ${typeIndex + 1}`}</h4>
            {(type.automations ?? []).map((rule, index) => (
              <Row key={index} onRemove={() => setType(typeIndex, { automations: (type.automations ?? []).filter((_, at) => at !== index) })}>
                <TextInput value={rule.name} aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} rule ${index + 1} name`} size="small" className="sm:w-72"
                  onChange={(event) => setType(typeIndex, { automations: (type.automations ?? []).map((entry, at) => at === index ? { ...entry, name: event.target.value } : entry) })} />
                <SelectField value={rule.on} aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} rule ${index + 1} trigger`} size="small"
                  onValueChange={(next) => setType(typeIndex, { automations: (type.automations ?? []).map((entry, at) => at === index ? { ...entry, on: next } : entry) })}
                  options={[...TRIGGER_EVENTS.map((event) => ({ value: event.action, label: `When ${event.label}` }))]} />
                <SelectField value={String(rule.moveTo)} aria-label={`${type.name || `Kind of work ${typeIndex + 1}`} rule ${index + 1} destination`} size="small"
                  onValueChange={(next) => setType(typeIndex, { automations: (type.automations ?? []).map((entry, at) => at === index ? { ...entry, moveTo: Number(next) } : entry) })}
                  options={stageOptions(type).map((option) => ({ ...option, label: `move it to ${option.label}` }))} />
              </Row>
            ))}
            <Button type="button" disabled={type.stages.length === 0} tone="secondary" size="small"
              onClick={() => setType(typeIndex, { automations: [...(type.automations ?? []), { name: '', on: TRIGGER_EVENTS[0].action, moveTo: 0 }] })}>
              Add a rule
            </Button>
          </div>
        ))}
      </Section>

      <Section title="What you call things" hidden={domain !== 'words'}>
        {shownNouns.map((entity) => (
          <div key={entity} className="flex flex-wrap items-center gap-2">
            <span className="w-full text-sm text-muted sm:w-24">{BUSINESS_NOUNS[entity].singular}</span>
            <TextInput value={nouns[entity]?.singular ?? ''} placeholder={BUSINESS_NOUNS[entity].singular} size="small"
              aria-label={`${BUSINESS_NOUNS[entity].singular}, one`} className="sm:w-56" onChange={(event) => setNoun(entity, 'singular', event.target.value)} />
            <TextInput value={nouns[entity]?.plural ?? ''} placeholder={BUSINESS_NOUNS[entity].plural} size="small"
              aria-label={`${BUSINESS_NOUNS[entity].plural}, several`} className="sm:w-56" onChange={(event) => setNoun(entity, 'plural', event.target.value)} />
          </div>
        ))}
        {/* Empty keeps the platform's word, shown as the placeholder. */}
      </Section>

      <Section title="What you record about customers" hidden={domain !== 'customers'}>
        {fieldEditor('customer', false)}
      </Section>

      <Section title="What customers can send you" hidden={domain !== 'customers'}>
        {portalForms.length === 0 ? <EmptyState>Nothing yet.</EmptyState> : null}
        {portalForms.map((form, index) => (
          <Row key={index} onRemove={() => set('portal', { forms: portalForms.filter((_, at) => at !== index) })}>
            <TextInput value={form.name} aria-label={`Customer form ${index + 1} name`} size="small" className="sm:w-72"
              onChange={(event) => set('portal', { forms: portalForms.map((entry, at) => at === index ? { ...entry, name: event.target.value } : entry) })} />
          </Row>
        ))}
      </Section>

      {/* **The two parts of a proposal that are about how the business appears rather than how
          it works**, and they are last on purpose: somebody reviewing a setup is deciding
          whether the stages and the prices are right, and a colour picker above that would be
          the least consequential thing on the screen sitting at the top of it. */}
      <Section title="What you say about yourself" hidden={domain !== 'presence'}>
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

      <Section title="How it looks" hidden={domain !== 'presence'}>
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
          <SelectField value={shape.brand?.headingFont ?? 'sans'} aria-label="Heading lettering" onValueChange={(next) => set('brand', {
                accent: shape.brand?.accent ?? '',
                headingFont: next,
                bodyFont: shape.brand?.bodyFont ?? 'sans',
              })} size="small" options={[...FONT_KEYS.map((key) => ({ value: key, label: `Headings: ${FONT_LABELS[key]}` }))]} />
          <SelectField value={shape.brand?.bodyFont ?? 'sans'} aria-label="Body lettering" onValueChange={(next) => set('brand', {
                accent: shape.brand?.accent ?? '',
                headingFont: shape.brand?.headingFont ?? 'sans',
                bodyFont: next,
              })} size="small" options={[...FONT_KEYS.map((key) => ({ value: key, label: `Text: ${FONT_LABELS[key]}` }))]} />
        </div>
      </Section>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <form action={save}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="shape" value={JSON.stringify(shape)} />
          <Button type="submit" disabled={pending || !dirty} tone="secondary" size="small">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </form>

        <form id={`apply-${proposal.id}`} action={apply}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          {dirty ? <Button type="button" disabled size="small">Apply this setup</Button> : <ConfirmSubmit formId={`apply-${proposal.id}`} label="Apply this setup" confirmLabel="Apply setup" tone="primary" pending={pending}
            description="Sets up your business as shown here. If something stops it part-way, what was done is kept and you can apply again to finish." />}
        </form>

        {proposal.origin !== 'drafted' ? (
          <form action={later}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="proposalId" value={proposal.id} />
            <Button type="submit" disabled={pending} tone="secondary" size="small">
              Not now
            </Button>
          </form>
        ) : null}

        <form action={discard}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="proposalId" value={proposal.id} />
          <Button type="submit" disabled={pending} tone="secondary" size="small">
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
      <Error state={laterState} />
    </div>
  );
}

/**
 * The first step for a new business: one card per published starting template and Start blank,
 * with the one matching what the founder said they do already chosen. Choosing a template opens
 * it as a draft on this same review screen; nothing is set up until it is applied there.
 */
export function StartingPointChooser({
  organizationId,
  templates,
  businesses = [],
  suggested,
}: {
  organizationId: string;
  templates: IndustryTemplate[];
  /** Other businesses this person manages, which this one may copy its setup from. */
  businesses?: { id: string; name: string }[];
  suggested: string | null;
}) {
  const [chosen, setChosen] = useState(suggested ?? '');
  const [state, start, starting] = useActionState(startAction, INITIAL);
  const options = [...templates.map((template) => ({ key: template.key, name: template.name, description: template.description })),
    ...businesses.map((business) => ({ key: `${COPY_PREFIX}${business.id}`, name: business.name, description: 'Copies its setup. Its customers, jobs and money stay there.' })),
    { key: '', name: 'Start blank', description: 'No work types or wording. You add them in Setup.' }];
  return (
    <form action={start} className="mt-6 space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="templateKey" value={chosen} />
      <div role="group" aria-label="Starting points" className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <SelectableCard key={option.key || 'blank'} selected={chosen === option.key} onClick={() => setChosen(option.key)}>
            <span className="font-medium">{option.name}</span>
            <span className="text-sm text-muted">{option.description}</span>
          </SelectableCard>
        ))}
      </div>
      <Button type="submit" disabled={starting}>{starting ? 'Opening…' : 'Continue'}</Button>
      <Error state={state} />
    </form>
  );
}
