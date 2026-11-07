import { DomainError } from '@/lib/domain/errors';
import { CUSTOM_FIELD_ENTITIES } from '@/lib/domain/fields/field-definitions';
import { BUSINESS_NOUNS } from '@/lib/domain/tenancy/business-profile';
import { isResourceClass } from '@/lib/domain/resources/resource-class';
import { isBusinessServes } from '@/lib/domain/tenancy/identity';
import type { BusinessShape, ShapeWorkType } from './configure';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const rows = (value: unknown, check: (item: Record<string, unknown>) => boolean): boolean => Array.isArray(value) && value.every((item) => record(item) && check(item));
const pairs = (value: unknown): boolean => Array.isArray(value) && value.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((index) => Number.isInteger(index)));
const optionalBoolean = (value: unknown): boolean => value === undefined || typeof value === 'boolean';
const automations = (value: unknown): boolean => value === undefined || rows(value, (rule) => typeof rule.name === 'string' && typeof rule.on === 'string' && Number.isInteger(rule.moveTo));
const words = (value: unknown): boolean => record(value) && typeof value.singular === 'string' && typeof value.plural === 'string';
const wholeOrNull = (value: unknown): boolean => value === null || Number.isInteger(value);
const policy = (value: unknown): boolean => value === undefined || (record(value)
  && wholeOrNull(value.cadenceMinutes) && Number.isInteger(value.minimumNoticeMinutes) && Number.isInteger(value.horizonDays)
  && typeof value.allowSameDay === 'boolean' && wholeOrNull(value.rescheduleCutoffMinutes) && wholeOrNull(value.cancelCutoffMinutes)
  && wholeOrNull(value.cancellationStage));

const workType = (value: Record<string, unknown>): boolean =>
  typeof value.name === 'string' && typeof value.schedulable === 'boolean'
  && rows(value.stages, (stage) => typeof stage.name === 'string' && optionalBoolean(stage.releasesResource) && optionalBoolean(stage.marksComplete))
  && pairs(value.transitions)
  && (value.checklist === undefined || strings(value.checklist))
  && (value.requirements === undefined || rows(value.requirements, (need) => isResourceClass(need.resourceClass) && Number.isInteger(need.quantity) && (need.capabilities === undefined || strings(need.capabilities))))
  && (value.booking === undefined || (record(value.booking) && Number.isInteger(value.booking.stage) && Number.isInteger(value.booking.durationMinutes) && policy(value.booking.policy)))
  && automations(value.automations);

/**
 * Structural boundary for untrusted documents. Values remain each canonical owner's rules.
 *
 * Two forms are accepted. The original single-type form (`typeName`, `schedulable`, `statuses`,
 * `transitions`) is still what drafting produces and what older stored proposals hold. The
 * `workTypes` form carries several kinds of work, each with its own stages and settings. A
 * document uses one form or the other, never both.
 */
export function readBusinessShape(value: unknown): BusinessShape {
  const multiple = record(value) && value.workTypes !== undefined;
  // The one structural gap with its own explanation: whether the work is scheduled is the business's to state.
  if (record(value) && !multiple && typeof value.schedulable !== 'boolean') {
    throw new DomainError('This setup does not say whether the work is scheduled.', 'configuration.schedulable_missing');
  }
  const kinds = record(value) && (multiple
    ? rows(value.workTypes, workType) && (value.workTypes as unknown[]).length > 0
      && value.typeName === undefined && value.schedulable === undefined && value.statuses === undefined && value.transitions === undefined && value.automations === undefined
    : typeof value.typeName === 'string' && typeof value.schedulable === 'boolean' && strings(value.statuses) && pairs(value.transitions) && automations(value.automations));
  const valid = record(value) && kinds
    && record(value.fields) && Object.entries(value.fields).every(([entity, fields]) =>
      (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(entity) && rows(fields, (field) => typeof field.key === 'string' && typeof field.label === 'string' && typeof field.kind === 'string' && typeof field.required === 'boolean' && (field.options === undefined || strings(field.options))))
    && rows(value.prices, (price) => typeof price.name === 'string' && typeof price.unit === 'string' && Number.isSafeInteger(price.amountMinor))
    && rows(value.hours, (hour) => Number.isInteger(hour.dayOfWeek) && typeof hour.opensAt === 'string' && typeof hour.closesAt === 'string')
    && rows(value.roles, (role) => typeof role.name === 'string' && strings(role.capabilities))
    && (value.modules === undefined || strings(value.modules))
    && (value.featureKeys === undefined || strings(value.featureKeys))
    && (value.voice === undefined || (record(value.voice) && typeof value.voice.tagline === 'string' && typeof value.voice.intro === 'string'))
    && (value.brand === undefined || (record(value.brand) && typeof value.brand.accent === 'string' && typeof value.brand.headingFont === 'string' && typeof value.brand.bodyFont === 'string'))
    && (value.wording === undefined || (record(value.wording)
      && (value.wording.nouns === undefined || (record(value.wording.nouns) && Object.entries(value.wording.nouns).every(([entity, nouns]) => entity in BUSINESS_NOUNS && words(nouns))))
      && (value.wording.labels === undefined || (record(value.wording.labels) && Object.values(value.wording.labels).every((label) => typeof label === 'string')))
      && (value.wording.navigation === undefined || strings(value.wording.navigation))))
    && (value.portal === undefined || (record(value.portal) && rows(value.portal.forms, (form) => typeof form.template === 'string' && typeof form.name === 'string')))
    && (value.serves === undefined || isBusinessServes(value.serves));
  if (!valid) throw new DomainError('This setup document is malformed. Review its fields before saving or applying it.', 'configuration.shape_invalid');
  return value as BusinessShape;
}

/** How "Choose a starting point" names another business to copy, beside the template keys it offers. */
export const COPY_PREFIX = 'business:';

/** Every kind of work a document describes, whichever form it is written in. */
export function workTypesOf(shape: BusinessShape): ShapeWorkType[] {
  if (shape.workTypes) return shape.workTypes;
  return [{
    name: shape.typeName ?? '',
    schedulable: shape.schedulable ?? false,
    // The single-type form says nothing about consequences; leaving the flags out leaves them as the database creates them.
    stages: (shape.statuses ?? []).map((name) => ({ name })),
    transitions: shape.transitions ?? [],
    automations: shape.automations,
  }];
}

/** The same document in the several-kinds form, which is what the review screen edits. */
export function withWorkTypes(shape: BusinessShape): BusinessShape {
  if (shape.workTypes) return shape;
  const rest: BusinessShape = { ...shape };
  for (const key of ['typeName', 'schedulable', 'statuses', 'transitions', 'automations'] as const) delete rest[key];
  return { ...rest, workTypes: workTypesOf(shape) };
}

/**
 * A template in a business's own words: `rename` swaps the template's words (names, stages, labels,
 * choices) for the business's, and `replace` overrides whole top-level parts, such as prices in the
 * business's own currency. Structure — how many stages, which moves, what is scheduled — stays the
 * template's. The staff and sales doors apply only `replace` (a shallow overlay, in SQL).
 */
export function adjustShape(shape: BusinessShape, adjustments: { rename?: Record<string, string>; replace?: Partial<BusinessShape> }): BusinessShape {
  const rename = adjustments.rename ?? {};
  const word = (value: string) => rename[value] ?? value;
  const nouns = shape.wording?.nouns
    ? Object.fromEntries(Object.entries(shape.wording.nouns).map(([entity, pair]) => [entity, { singular: word(pair.singular), plural: word(pair.plural) }]))
    : undefined;
  const renamed: BusinessShape = {
    ...shape,
    typeName: shape.typeName === undefined ? undefined : word(shape.typeName),
    statuses: shape.statuses?.map(word),
    workTypes: shape.workTypes?.map((type) => ({
      ...type,
      name: word(type.name),
      stages: type.stages.map((stage) => ({ ...stage, name: word(stage.name) })),
      checklist: type.checklist?.map(word),
      requirements: type.requirements?.map((need) => ({ ...need, capabilities: need.capabilities?.map(word) })),
      automations: type.automations?.map((rule) => ({ ...rule, name: word(rule.name) })),
    })),
    fields: Object.fromEntries(Object.entries(shape.fields).map(([entity, fields]) => [entity, fields?.map((field) => ({
      ...field, label: word(field.label), options: field.options?.map(word),
    }))])),
    prices: shape.prices.map((price) => ({ ...price, name: word(price.name), unit: word(price.unit) })),
    roles: shape.roles.map((role) => ({ ...role, name: word(role.name) })),
    wording: shape.wording ? { ...shape.wording, nouns, labels: shape.wording.labels ? Object.fromEntries(Object.entries(shape.wording.labels).map(([key, label]) => [key, word(label)])) : undefined } : undefined,
    portal: shape.portal ? { forms: shape.portal.forms.map((form) => ({ ...form, name: word(form.name) })) } : undefined,
  };
  // JSON round trip drops the `undefined` keys the spread above introduced, so the result reads back as the form it was written in.
  return readBusinessShape(JSON.parse(JSON.stringify({ ...renamed, ...adjustments.replace })));
}
