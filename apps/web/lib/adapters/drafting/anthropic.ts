import Anthropic from '@anthropic-ai/sdk';

import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { FIELD_KINDS, CUSTOM_FIELD_ENTITIES } from '@/lib/domain/fields/field-definitions';
import { TRIGGER_EVENTS } from '@/lib/domain/automation/rules';
import { FONT_KEYS } from '@/lib/domain/branding/palette';
import type { BusinessShape } from '@/lib/domain/onboarding/configure';
import type {
  ConfigurationGap,
  DraftedConfiguration,
  DraftingProvider,
  DraftingRequest,
} from './index';

/**
 * The drafting capability, behind the interface that names it.
 *
 * **One of two files in this repository that knows this vendor exists**, the other being the
 * registry that chooses it. Everything above asks for a proposed configuration; this is the one
 * place that knows who is asked, and I15 is the test that keeps it so.
 *
 * **An SDK here, unlike the other two adapters.** Payments and geocoding both refused one
 * because each needed a single stable HTTPS call and a query string. This needs constrained
 * decoding — the schema below is enforced by the API rather than hoped for — and reimplementing
 * that against the wire format would be maintaining a client for no benefit.
 *
 * **The schema is built from the domain's own lists**, imported rather than restated:
 * capabilities, field kinds, entities and trigger events all come from the files that define
 * them. A hand-copied enum here would be correct on the day it was written and wrong on the day
 * somebody added a capability, and the failure would be a proposal quietly unable to express
 * something the platform supports.
 *
 * **Nothing here writes anything.** No database handle reaches this file and no domain function
 * is called from it — the imports above are types and constant lists. That is the whole of how
 * I14 holds on this path (D32): the model has no tool, so there is no permitted write to check.
 */

const MODEL = 'claude-opus-5';

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
          'statuses',
          'transitions',
          'fields',
          'prices',
          'hours',
          'roles',
          'automations',
        ],
        properties: {
          typeName: {
            type: 'string',
            description:
              "What this business calls the work it does, in its own words -- 'Repair', 'Consultation', 'Hire'. Never a platform word like 'job' or 'ticket' unless the business used it.",
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
                'Which part of the shape the question concerns: typeName, statuses, transitions, fields, prices, hours, roles, automations, voice or brand.',
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

/**
 * What the model is told about its job.
 *
 * **The two rules in it are this repository's, not prompt-craft.** It may not invent a working
 * week, because `constraints.md` forbids the platform holding one and a drafted default would
 * be that same hardcoded week arriving through a different door. And it must raise a gap rather
 * than guess a price, because a number nobody said is a claim the business would be publishing
 * without having made it — the same line the public pages hold.
 */
const SYSTEM = [
  'You help somebody set up their business on an operations platform. You are drafting a',
  'proposal that they will read, edit and apply themselves. Nothing you produce takes effect',
  'until they approve it.',
  '',
  'Use their words. The name of their work, their stages, their roles and their services are',
  'theirs — take the vocabulary from what they wrote and do not translate it into generic',
  'software terms. If they say "MOT", the status is "MOT", not "Inspection".',
  '',
  'Do not invent facts about their business. In particular:',
  '- Never invent opening hours. If they did not say when they work, return an empty list and',
  '  ask. A Monday-to-Friday week nobody mentioned is a guess that looks like a setting.',
  '- Never invent a price. If they named a service but not what it costs, put nothing in the',
  '  price list for it and ask what they charge.',
  '- Give a role only the capabilities that job actually needs.',
  '- Never write a claim they did not make. The tagline and the introduction are what this',
  '  business says about itself to its own customers, so they are built from their words or',
  '  left empty. "Quality service, guaranteed" is something you made up about somebody else.',
  '- A colour only if they named one, or if their trade has one nobody would dispute. Leave it',
  '  empty otherwise: a colour you invented is on every screen they look at.',
  '',
  'Raise a gap for anything you were thin about. A short proposal with three good questions is',
  'better than a complete-looking one built on assumptions. Ask in plain language: the person',
  'reading it runs a business and does not know what a status or a capability is.',
  '',
  'When a previous proposal is supplied, treat the new message as a correction or an answer to',
  'your questions. Keep everything they already agreed to and change only what they addressed.',
].join('\n');

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

/** Every value in `list` that is a string, and nothing else. */
function strings(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  return list.every((entry) => typeof entry === 'string') ? (list as string[]) : null;
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

  const statuses = strings(shape.statuses);
  if (typeof shape.typeName !== 'string' || statuses === null) return null;

  if (!Array.isArray(shape.transitions) || !Array.isArray(shape.prices)) return null;
  if (!Array.isArray(shape.hours) || !Array.isArray(shape.roles)) return null;
  if (typeof shape.fields !== 'object' || shape.fields === null) return null;

  const transitions: [number, number][] = [];
  for (const pair of shape.transitions) {
    // A pair with a third element is not a transition, whatever else it might be. Refused here
    // rather than silently truncated, because a truncated one is a legal-looking move nobody
    // proposed.
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    if (!pair.every((index) => typeof index === 'number')) return null;
    transitions.push([pair[0] as number, pair[1] as number]);
  }

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

  return {
    shape: {
      ...(shape as unknown as BusinessShape),
      statuses,
      transitions,
      voice:
        voice && typeof voice.tagline === 'string' && typeof voice.intro === 'string'
          ? { tagline: voice.tagline, intro: voice.intro }
          : undefined,
      brand:
        brand &&
        typeof brand.accent === 'string' &&
        typeof brand.headingFont === 'string' &&
        typeof brand.bodyFont === 'string'
          ? {
              accent: brand.accent,
              headingFont: brand.headingFont,
              bodyFont: brand.bodyFont,
            }
          : undefined,
    },
    gaps,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function anthropicDraftingProvider(config: { apiKey: string }): DraftingProvider {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    name: 'Claude',

    async draft(input): Promise<DraftedConfiguration | null> {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: responseSchema() },
        },
        messages: [{ role: 'user', content: userMessage(input) }],
      });

      // A decline is something the business can act on by writing a different description, so it
      // comes back as null — the contract's distinction, and the same one geocoding draws
      // between an address nobody recognises and a provider that is down.
      if (response.stop_reason === 'refusal') return null;

      // Not a refusal and not an answer. A truncated proposal is worse than none, because the
      // half that arrived looks complete on screen.
      if (response.stop_reason === 'max_tokens') {
        throw new Error('The drafted configuration was cut off before it finished.');
      }

      const text = response.content.find((block) => block.type === 'text');
      if (!text || text.type !== 'text') {
        throw new Error('The drafting provider returned no configuration.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text.text);
      } catch {
        throw new Error('The drafting provider returned something that is not a configuration.');
      }

      return narrow(parsed);
    },
  };
}
