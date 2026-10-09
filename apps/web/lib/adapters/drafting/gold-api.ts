import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { FIELD_KINDS, CUSTOM_FIELD_ENTITIES } from '@/lib/domain/fields/field-definitions';
import { TRIGGER_EVENTS } from '@/lib/domain/automation/rules';
import { FONT_KEYS } from '@/lib/domain/branding/palette';
import { MODULES } from '@/lib/navigation';
import { readBusinessShape } from '@/lib/domain/configuration/shape';
import {
  DraftingNotEntitledError,
  type ConfigurationGap,
  type DraftedConfiguration,
  type DraftingProvider,
  type DraftingRequest,
} from './index';

/**
 * The drafting capability, behind the interface that names it — and `apps/api` is who is asked.
 *
 * **No vendor, no model and no key in this file.** Which provider drafts, with which account and
 * which model, is `platform_ai_runtime_assignments`' decision for the `configuration_drafting`
 * capability, made and read by `apps/api` (D34, D62); this runtime used to hold its own Anthropic
 * key and a model name hard-coded in source, which was a third answer to a question that has one.
 * What it consumes is metered there, through the same writer as every other AI request.
 *
 * **What stays here is the vocabulary.** The schema below is built from the domain's own lists,
 * imported rather than restated: capabilities, field kinds, entities, trigger events, modules and
 * fonts all come from the files that define them. A hand-copied enum would be correct on the day
 * it was written and wrong on the day somebody added a capability, and the failure would be a
 * proposal quietly unable to express something the platform supports. It is sent to `apps/api` as
 * the input schema of the model's one way to answer, and the answer is narrowed back into the
 * domain's own types here (`narrow`).
 *
 * **Nothing here writes anything.** No database handle reaches this file and no domain function
 * is called from it — the imports above are types and constant lists. That is the whole of how
 * I14 holds on this path (D32): the model has no tool, so there is no permitted write to check.
 * Nothing is retried: a second attempt nobody asked for is a second bill.
 */

/** One custom field, as the schema describes it. Five entities share it. */
const FIELD_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'label', 'kind', 'required', 'options'],
    properties: {
      key: {
        type: 'string',
        description:
          'A short stable identifier in snake_case. Never changes once the business is configured.',
      },
      label: { type: 'string', description: "What the business calls it, in its own words." },
      kind: { type: 'string', enum: [...FIELD_KINDS] },
      required: { type: 'boolean' },
      // **Required in the schema and allowed to be empty**, because this API's structured
      // output has no way to say *required only when kind is select*. Always asking for the
      // array and letting it be empty is the shape that fits: a text field answers `[]`, and
      // a choice field that answers `[]` is refused by `createFieldDefinition` with a sentence
      // rather than accepted as a dropdown nobody can use.
      options: {
        type: 'array',
        items: { type: 'string' },
        description:
          "The choices, for kind 'select' or 'multi_select' only, in the business's own words and its own order. An empty array for every other kind.",
      },
    },
  },
} as const;

/**
 * The response format, enforced by the API rather than requested in prose.
 *
 * Two limits of JSON Schema as this API supports it are worth naming, because both are handled
 * elsewhere rather than being oversights. There are **no numeric bounds**, so a day of week
 * outside 1–7 or a negative price is expressible here and refused by `addOperatingHours` and
 * `createPriceBookItem` — which were already refusing it before this file existed. And
 * **`transitions` cannot be constrained to pairs**, so it is an array of integer arrays and
 * `configureBusiness` destructures the first two; `validateTransitions` already refuses an index
 * that names no status, and its own comment says it exists for exactly this caller.
 *
 * The lesson underneath both: **this schema shapes the answer, and the domain layer is the
 * guarantee.** Treating a constrained decode as validation would put a second copy of every
 * rule in the one place that cannot be tested against a real database.
 */
function responseSchema(): Record<string, unknown> {
  const fields = Object.fromEntries(
    CUSTOM_FIELD_ENTITIES.map((entity) => [entity, FIELD_SCHEMA]),
  );

  return {
    type: 'object',
    additionalProperties: false,
    required: ['shape', 'gaps'],
    properties: {
      shape: {
        type: 'object',
        additionalProperties: false,
        required: [
          'typeName',
          'schedulable',
          'statuses',
          'transitions',
          'fields',
          'prices',
          'hours',
          'roles',
          'automations',
          'modules',
        ],
        properties: {
          typeName: {
            type: 'string',
            description:
              "What this business calls the work it does, in its own words -- 'Repair', 'Consultation', 'Hire'. Never a platform word like 'job' or 'ticket' unless the business used it.",
          },
          schedulable: {
            type: 'boolean',
            description:
              'True when this work happens at a time the business plans (visits, appointments, installations); false when it has no set time (an enquiry, a sales opportunity). Ask if the description does not say.',
          },
          statuses: {
            type: 'array',
            items: { type: 'string' },
            description:
              "The lifecycle of that work, in this business's own words and its own length, in the order it happens.",
          },
          transitions: {
            type: 'array',
            items: { type: 'array', items: { type: 'integer' } },
            description:
              'Which moves are legal, as pairs of zero-based indices into statuses: [from, to]. An empty list means the business has not said how its work moves, which freezes the type rather than leaving it unconstrained.',
          },
          fields: {
            type: 'object',
            additionalProperties: false,
            required: [...CUSTOM_FIELD_ENTITIES],
            properties: fields,
            description:
              'The extra things this business records about each entity, beyond what the platform already holds. Empty arrays are the normal answer for most entities.',
          },
          prices: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'unit', 'amountMinor'],
              properties: {
                name: { type: 'string' },
                unit: {
                  type: 'string',
                  description: "What one of it is: 'hour', 'visit', 'each', 'day'.",
                },
                amountMinor: {
                  type: 'integer',
                  description:
                    'Whole minor units of the currency named in the request: 4250 for 42.50 in a currency with cents, 4250 for 4250 in a currency without them.',
                },
              },
            },
          },
          hours: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['dayOfWeek', 'opensAt', 'closesAt'],
              properties: {
                dayOfWeek: {
                  type: 'integer',
                  description: 'ISO 8601: 1 is Monday through 7 is Sunday.',
                },
                opensAt: { type: 'string', description: 'Wall clock in the given zone, HH:MM.' },
                closesAt: { type: 'string', description: 'Wall clock in the given zone, HH:MM.' },
              },
            },
            description:
              'Only the days this business actually said it works. An empty list means it has said nothing, which is treated as always open -- never invent a Monday-to-Friday week.',
          },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'capabilities'],
              properties: {
                name: { type: 'string' },
                capabilities: { type: 'array', items: { type: 'string', enum: [...CAPABILITIES] } },
              },
            },
            description:
              'Roles besides the founder’s, named as this business names its people, each holding only what that job actually needs.',
          },
          automations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'on', 'moveTo'],
              properties: {
                name: { type: 'string' },
                on: { type: 'string', enum: TRIGGER_EVENTS.map((event) => event.action) },
                moveTo: {
                  type: 'integer',
                  description: 'Zero-based index into statuses.',
                },
              },
            },
            description:
              'What this business does without anybody present. An empty list is an ordinary answer.',
          },
          modules: {
            type: 'array',
            items: { type: 'string', enum: MODULES.map((module) => module.key) },
            // Built from `MODULES` rather than restated, the same rule the header states about
            // every other list here — so a module added to the platform is offered without
            // anybody remembering this file, and one removed cannot be proposed.
            description: [
              'Which parts of the platform this business needs, from what they described. Only',
              'what they actually said they do — a module nobody mentioned is something they',
              'have to pay for, so leave it out and ask instead. What each one is:',
              ...MODULES.map((module) => `- ${module.key}: ${module.description}`),
            ].join(' '),
          },
          voice: {
            type: 'object',
            additionalProperties: false,
            required: ['tagline', 'intro'],
            properties: {
              tagline: {
                type: 'string',
                description:
                  'One line under the business name on its public page, in their words. Empty if they gave you nothing to say it with.',
              },
              intro: {
                type: 'string',
                description:
                  'A short paragraph a customer reads before booking, in their words. Empty if they gave you nothing to say it with.',
              },
            },
            description:
              'What this business says about itself on a page its customers see. Their claims, never yours.',
          },
          brand: {
            type: 'object',
            additionalProperties: false,
            required: ['accent', 'headingFont', 'bodyFont'],
            properties: {
              accent: {
                type: 'string',
                description:
                  'Lowercase #rrggbb, or empty. Only if they named a colour or their trade has an unmistakable one. Contrast is handled by the platform, so pick the colour itself and do not adjust it for readability.',
              },
              headingFont: { type: 'string', enum: [...FONT_KEYS] },
              bodyFont: { type: 'string', enum: [...FONT_KEYS] },
            },
            description:
              'How this business looks. Lettering: plain (sans), traditional (serif) or technical (mono).',
          },
        },
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'question'],
          properties: {
            field: {
              type: 'string',
              description:
                'Which part of the shape the question concerns: typeName, schedulable, statuses, transitions, fields, prices, hours, roles, automations, modules, voice or brand.',
            },
            question: {
              type: 'string',
              description:
                'One plain question, asked of somebody who does not know what a status is.',
            },
          },
        },
      },
    },
  };
}

function userMessage(input: DraftingRequest): string {
  const parts = [
    `The business is called ${input.business.name}.`,
    input.business.currency
      ? `It trades in ${input.business.currency} and its working day is in the ${input.business.timeZone} time zone.`
      : `It has not said what it trades in yet, so propose amounts as plain minor units and do not name a currency. Its working day is in the ${input.business.timeZone} time zone.`,
    '',
    'What they said about themselves:',
    input.description,
  ];

  if (input.current) {
    parts.push(
      '',
      'The proposal they are currently looking at, which you are revising:',
      JSON.stringify(input.current),
    );
  }

  return parts.join('\n');
}

/**
 * The answer, narrowed into the domain's own types — or null.
 *
 * **Constrained decoding is not a type guarantee at this boundary and must not be treated as
 * one.** The API enforces the schema, and the schema is a document in this file that can fall
 * out of step with `BusinessShape` in a way TypeScript cannot see, because `JSON.parse` returns
 * `any`. So the answer is checked before it crosses, and a malformed one comes back as a
 * refusal rather than as a shape the domain layer will trust.
 *
 * This does **not** re-check what the domain layer owns: nothing here refuses a negative price,
 * an eighth day of the week or a transition naming a status that does not exist.
 * `createPriceBookItem`, `addOperatingHours` and `validateTransitions` already do, and a second
 * copy here would be the duplicated rule this repository refuses everywhere else.
 */
function narrow(value: unknown): DraftedConfiguration | null {
  if (typeof value !== 'object' || value === null) return null;
  const answer = value as Record<string, unknown>;

  const rawShape = answer.shape;
  if (typeof rawShape !== 'object' || rawShape === null) return null;
  const shape = rawShape as Record<string, unknown>;

  const gaps: ConfigurationGap[] = [];
  for (const gap of Array.isArray(answer.gaps) ? answer.gaps : []) {
    if (typeof gap !== 'object' || gap === null) continue;
    const entry = gap as Record<string, unknown>;
    if (typeof entry.field !== 'string' || typeof entry.question !== 'string') continue;
    gaps.push({ field: entry.field, question: entry.question });
  }

  // **Dropped rather than refused, and only these two.** Everything above is structural — a
  // shape without statuses is not a shape — while a malformed `voice` or `brand` is one optional
  // part of an otherwise good proposal, and losing the whole draft over a colour would be worse
  // than losing the colour. What is not done here is checking the *values*: whether `#ff` is a
  // colour is `setBrand`'s to answer, and a second copy of that rule is what this file's header
  // refuses.
  const voice = record(shape.voice);
  const brand = record(shape.brand);

  try {
    return {
      shape: readBusinessShape({
        ...shape,
        voice:
          voice && typeof voice.tagline === 'string' && typeof voice.intro === 'string'
            ? { tagline: voice.tagline, intro: voice.intro }
            : undefined,
        brand:
          brand &&
          typeof brand.accent === 'string' &&
          typeof brand.headingFont === 'string' &&
          typeof brand.bodyFont === 'string'
            ? { accent: brand.accent, headingFont: brand.headingFont, bodyFont: brand.bodyFont }
            : undefined,
      }),
      gaps,
    };
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function goldApiDraftingProvider(config: { baseUrl: string }): DraftingProvider {
  return {
    name: 'gold',

    async draft(input): Promise<DraftedConfiguration | null> {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/ai/draft-configuration`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The caller's own token, forwarded rather than exchanged — identity reaches the
          // database as their JWT, and the far side reads the entitlement as them (D17).
          authorization: `Bearer ${input.token}`,
        },
        body: JSON.stringify({
          question: userMessage(input),
          organization_id: input.organizationId,
          schema: responseSchema(),
        }),
        signal: AbortSignal.timeout(180_000),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        // Its own error, not a generic one: not holding guided setup is a fact about the business,
        // and "something went wrong" is the wrong sentence for it.
        if (response.status === 403 && body.code === 'not_entitled') throw new DraftingNotEntitledError();
        throw new Error(body.error ?? `the drafting service is unavailable (${response.status})`);
      }

      const body = (await response.json()) as {
        outcome?: string;
        configuration?: unknown;
        detail?: string;
      };

      // A decline is something the business can act on by writing a different description, so it
      // comes back as null — the contract's distinction, and the same one geocoding draws
      // between an address nobody recognises and a provider that is down.
      if (body.outcome === 'declined') return null;

      if (body.outcome !== 'drafted') {
        throw new Error(body.detail || 'The drafting provider returned no configuration.');
      }

      // `narrow` returns null for a malformed answer, which reads as a decline. That is the same
      // answer the old direct path gave, and the domain layer remains the guarantee either way.
      return narrow(body.configuration);
    },
  };
}
