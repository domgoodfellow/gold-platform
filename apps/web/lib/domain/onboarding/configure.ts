import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  createFieldDefinition,
  listFieldDefinitions,
  updateFieldDefinition,
  type CustomFieldEntity,
  type FieldKind,
} from '@/lib/domain/fields/field-definitions';
import {
  addAutomationAction,
  createAutomationRule,
} from '@/lib/domain/automation/rules';
import { setBrand } from '@/lib/domain/branding/brand';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { createRole } from '@/lib/domain/tenancy/roles';
import { publicProfile, setPublicProfile } from '@/lib/domain/tenancy/profile';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition } from '@/lib/domain/work-items/transitions';
import { createWorkItemType } from '@/lib/domain/work-items/types';

/**
 * Standing a whole business up from data, in one function with no branch in it.
 *
 * **This is `milestone-m3.test.ts`'s `configure`, moved.** That file's structural claim was
 * that exactly one function, taking every word, number, status, field, order, currency, zone
 * and price as *data*, could stand up an equipment hire yard in Amsterdam and a clinic in
 * Tokyo — and that had either shape needed a branch, the function could not exist. The claim
 * held, and then the function sat in a test where nothing but a test could call it.
 *
 * It moves here under this repository's own rule: *if a second caller needs a rule that is
 * currently inline, extract it first, then call it twice.* The second caller is the AI
 * onboarding flow `roadmap.md` M8 describes and `constraints.md` D29 makes self-serve signup
 * conditional on — describe a business in prose, receive a proposed configuration, review it,
 * apply it. `BusinessShape` below is what that proposal *is*, which is why it is a type rather
 * than an argument list: a proposal has to survive being generated, rendered, edited by a
 * human and only then applied, and a function's parameters cannot hold it across those steps.
 *
 * **This is not a business template** (`constraints.md`, *Decided, not yet built*). A template
 * is a named bundle this platform ships and a business starts from; a shape is supplied by a
 * caller. The distinction is the one that record cares about: nothing here is seeded, named,
 * or known to the platform in advance.
 *
 * **It deliberately does not create a customer or a job.** The test's version ended by making
 * one of each so it had something to assert against, and that was evidence rather than
 * configuration — a business that has just been stood up has no customers, and inventing one
 * would be the platform putting words in its mouth exactly where D6 and D20 say it may not.
 *
 * **It is not atomic, and that is the honest limitation.** `create_organization` is a
 * transaction and each call below is a transaction, but the sequence is not one: a failure at
 * the price book leaves an organization with its statuses and no catalogue. Nothing is lost
 * and nothing is corrupt — the result is a partly-configured business, which is a state every
 * screen already handles, because it is also the state of a business somebody is configuring
 * by hand. Making the sequence atomic means one privileged function taking the shape as JSON,
 * which puts the order of these steps in the database; that is a real option and it needs a
 * caller who cannot tolerate the partial state. Neither of the two has said so.
 */

/** One custom field, on whichever entity carries it. */
export type ShapeField = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
};

/**
 * One rule, as data.
 *
 * **Statuses by index, for the reason transitions already are**: a shape is written before
 * anything has an id, and a name is a string a proposal can get subtly wrong twice.
 *
 * Deliberately the smallest rule that is a whole rule — a moment to watch for and a status to
 * move to. Conditions, messages, timings and counters are all expressible as rows and none of
 * them is here, because a shape is what somebody stands a business up with and nothing in M6's
 * two callers has asked to start with a conditional one. Adding a field here later costs
 * nothing; adding four now would be four fields nobody fills in.
 */
export type ShapeAutomation = {
  /** What this business calls the rule. Rendered as written, never translated. */
  name: string;
  /** An `events.action` this platform publishes — see `TRIGGER_EVENTS`. */
  on: string;
  /** Which status to move the job into, as an index into `statuses`. */
  moveTo: number;
};

/**
 * A business, as data.
 *
 * Nothing in this type is a platform decision. The platform supplies `Customer`, `Work Item`,
 * `Resource` and `Event` — `vision.md`'s "what is not negotiable is the primitives" — and
 * every word describing them here belongs to the tenant.
 */
export type BusinessShape = {
  /** What this business calls the work it does. */
  typeName: string;
  /** Its lifecycle, in its own words and its own length. */
  statuses: string[];
  /**
   * Which moves are legal, as pairs of indices into `statuses`.
   *
   * Indices rather than names, because a shape is written before anything has an id and
   * because a name is a string a proposal can get subtly wrong twice. A type with no
   * transitions is frozen rather than unconstrained (I13), so an empty list is a valid answer
   * and means this business has not said how its work moves.
   */
  transitions: [number, number][];
  /** Its own form, in its own order — `position` is applied explicitly below. */
  fields: Partial<Record<CustomFieldEntity, ShapeField[]>>;
  /** What it charges for. Amounts are minor units in *its* currency (I10). */
  prices: { name: string; unit: string; amountMinor: number }[];
  /** When it is open. Empty means it has said nothing, which is treated as always open. */
  hours: { dayOfWeek: number; opensAt: string; closesAt: string }[];
  /** Roles that are not the founder's, holding what this business decided it needs. */
  roles: { name: string; capabilities: string[] }[];
  /**
   * What it does without anybody present.
   *
   * Optional, because a business that automates nothing is an ordinary business and a shape
   * written before M6 existed is still a valid shape.
   */
  automations?: ShapeAutomation[];
  /**
   * What it says about itself, in its own words.
   *
   * **The only part of a shape that is prose rather than structure**, and it is here for the
   * reason `constraints.md` forbids hardcoding a claim a business makes about itself: a public
   * page with no tagline renders a name and stops, which is honest and blank. A business that
   * has just described itself in a paragraph has already said the thing that belongs there.
   *
   * Optional, and empty strings clear rather than write. A shape written before this existed is
   * still a valid shape.
   */
  voice?: { tagline: string; intro: string };
  /**
   * How it looks: one colour and a pair of lettering choices.
   *
   * Optional for the same reason. **No branch on what kind of business this is** — a colour is
   * a colour whoever chose it, which is what lets this field sit inside a function that must
   * never learn what it is holding.
   */
  brand?: { accent: string; headingFont: string; bodyFont: string };
};

/** What standing a business up produced, so a caller can carry on working with it. */
export type ConfiguredBusiness = {
  organizationId: string;
  typeId: string;
  /** In `shape.statuses` order, so an index into one indexes the other. */
  statusIds: string[];
  roleIds: string[];
  priceBookItemIds: string[];
  /** In `shape.automations` order, so an index into one indexes the other. */
  automationRuleIds: string[];
};

/**
 * Every transition names a status this shape actually has.
 *
 * Checked before anything is written rather than left to fail on the fourth call, because the
 * caller this exists for is a language model and an out-of-range index is exactly what it will
 * produce. The message names the offending index, since a proposal is read by a human who has
 * to fix it.
 */
function validateTransitions(shape: BusinessShape): void {
  for (const pair of shape.transitions) {
    for (const index of pair) {
      if (!Number.isInteger(index) || index < 0 || index >= shape.statuses.length) {
        throw new DomainError(
          `A transition names status ${index}, and this business has ${shape.statuses.length}.`,
          'onboarding.transition_out_of_range',
        );
      }
    }
  }

  // The same check on the same kind of mistake, for the same caller. A rule naming a status
  // this shape does not have would otherwise fail on the last call of the sequence, after
  // everything else had already been written.
  for (const automation of shape.automations ?? []) {
    if (
      !Number.isInteger(automation.moveTo) ||
      automation.moveTo < 0 ||
      automation.moveTo >= shape.statuses.length
    ) {
      throw new DomainError(
        `A rule names status ${automation.moveTo}, and this business has ${shape.statuses.length}.`,
        'onboarding.automation_out_of_range',
      );
    }
  }
}

/**
 * Configure a business that already exists.
 *
 * **It no longer creates the business, and the database is what decided that.** The first
 * version after D29 closed founding stood the business up through the operator door and then
 * carried on configuring it in the same call — which fails at the second step, because
 * `createRole` and everything after it run against policies keyed to `app.current_tenant_ids()`
 * and platform staff are a member of nothing. That is I21 refusing exactly what it says it
 * refuses: staff may bring a tenant into existence and may not reach into one.
 *
 * So standing a business up is two acts by two parties, which is **D29's axis stated as code**:
 * GOLD creates the business (`provisionOrganization`), and whoever does the configuring
 * configures it. Today that is the owner, holding their own session. At M8 it is the same call
 * made after a human reviews a proposal. Neither is a second creation path, and neither can
 * become one, because nothing here creates anything.
 *
 * What has not changed is the part the milestone turns on: a fixed sequence of domain calls
 * with **no branch on which business it is holding**, which `milestone-m3.test.ts` asserts by
 * reading this function's own source.
 */
export async function configureBusiness(
  db: Db,
  organizationId: string,
  shape: BusinessShape,
): Promise<ConfiguredBusiness> {
  validateTransitions(shape);

  const roleIds: string[] = [];
  for (const role of shape.roles) {
    roleIds.push(
      await createRole(db, {
        organizationId,
        name: role.name,
        capabilities: role.capabilities,
      }),
    );
  }

  const typeId = await createWorkItemType(db, { organizationId, name: shape.typeName });

  const statusIds: string[] = [];
  for (const [position, name] of shape.statuses.entries()) {
    statusIds.push(await createWorkItemStatus(db, { organizationId, typeId, name, position }));
  }

  for (const [from, to] of shape.transitions) {
    await createWorkItemTransition(db, {
      organizationId,
      typeId,
      fromStatusId: statusIds[from],
      toStatusId: statusIds[to],
    });
  }

  // The form, then its order. Definitions are appended as they are created, so a business that
  // wants a different order has to say so — which is what the registry gained in M3, and why
  // `position` is a second pass rather than an argument to the first.
  const entries = Object.entries(shape.fields) as [CustomFieldEntity, ShapeField[]][];
  for (const [entityType, fields] of entries) {
    for (const field of fields) {
      await createFieldDefinition(db, { organizationId, entityType, ...field });
    }

    const defined = await listFieldDefinitions(db, { organizationId, entityType });
    for (const definition of defined) {
      const position = fields.findIndex((field) => field.key === definition.key);
      // A definition this shape did not ask for belongs to somebody else's ordering, and is
      // left where it is. There are none today; there will be the first time a shape is
      // applied to a business that already has fields.
      if (position === -1) continue;
      await updateFieldDefinition(db, {
        id: definition.id,
        label: definition.label,
        required: definition.required,
        position,
      });
    }
  }

  for (const hours of shape.hours) {
    await addOperatingHours(db, { organizationId, ...hours });
  }

  const priceBookItemIds: string[] = [];
  for (const price of shape.prices) {
    priceBookItemIds.push(
      await createPriceBookItem(db, {
        organizationId,
        name: price.name,
        unit: price.unit,
        unitAmountMinor: price.amountMinor,
      }),
    );
  }

  // Last, because a rule names a status and the statuses are written above it. That is the
  // only reason for the position — nothing here branches on what the rule says, any more than
  // anything above branches on what the statuses are called.
  const automationRuleIds: string[] = [];
  for (const automation of shape.automations ?? []) {
    const ruleId = await createAutomationRule(db, {
      organizationId,
      name: automation.name,
      triggerKind: 'event',
      triggerEventAction: automation.on,
    });
    await addAutomationAction(db, {
      organizationId,
      ruleId,
      kind: 'change_status',
      statusId: statusIds[automation.moveTo],
    });
    automationRuleIds.push(ruleId);
  }

  // **Last, and after everything that can fail on a capability.** How a business looks and what
  // it says about itself are `organization.manage`, while everything above is a different
  // capability each — so a member configuring a business they may operate but not rename gets
  // the whole operational setup and is refused only here, rather than being refused first and
  // getting nothing.
  //
  // Nothing branches on the content. A tagline is written because the shape carried one, not
  // because of what it says.
  if (shape.voice) {
    // **Read first, because `setPublicProfile` writes the whole row.** A shape carries two of
    // its six fields, so passing empty strings for the rest would clear a phone number this
    // business had already typed in — which is exactly the failure mode a form that forgets a
    // hidden field has, arriving through a domain call instead.
    const existing = await publicProfile(db, { organizationId, fallbackName: '' });

    await setPublicProfile(db, {
      organizationId,
      // Not part of the voice: a business's public display name is `organizations.name` until
      // it says otherwise, and having the drafting propose a second name for the same business
      // is how two names start disagreeing.
      displayName: existing.displayName,
      tagline: shape.voice.tagline,
      intro: shape.voice.intro,
      contactEmail: existing.contactEmail ?? '',
      contactPhone: existing.contactPhone ?? '',
      address: existing.address ?? '',
    });
  }

  if (shape.brand) {
    await setBrand(db, {
      organizationId,
      accent: shape.brand.accent,
      headingFont: shape.brand.headingFont,
      bodyFont: shape.brand.bodyFont,
    });
  }

  return { organizationId, typeId, statusIds, roleIds, priceBookItemIds, automationRuleIds };
}
