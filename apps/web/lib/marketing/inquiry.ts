import { AVAILABILITY, OFFERINGS, type Offering } from './content';

/**
 * What the consultation form (`/demo`) asks, and how its answers become the text GildOps' CRM keeps.
 *
 * Only values listed here are kept: a product, or a Dialer answer, that is not one of these options
 * is dropped rather than stored, so a crafted request cannot put arbitrary wording in the
 * "what they asked about" answer. The visitor's own words go in the free-text field, which the
 * intake bounds and stores separately.
 */

export interface InquiryTopic {
  value: string;
  label: string;
  /** The product, when the topic is one. */
  offering?: Offering;
}

export const INQUIRY_TOPICS: InquiryTopic[] = [
  ...OFFERINGS.map((offering) => ({ value: offering.id, label: offering.name, offering })),
  { value: 'several', label: 'Several products' },
  { value: 'unsure', label: 'Not sure yet' },
];

/** The topic a form value or `?product=` names, or null for anything else. */
export function inquiryTopic(value: unknown): InquiryTopic | null {
  if (typeof value !== 'string') return null;
  return INQUIRY_TOPICS.find((topic) => topic.value === value) ?? null;
}

/** One line under the product choice when that product cannot be had yet, so the visitor knows before sending. */
export function inquiryTopicNote(topic: InquiryTopic | null): string | null {
  if (!topic?.offering || topic.offering.availability !== 'not_yet') return null;
  const name = topic.offering.inSentence;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} is ${AVAILABILITY.not_yet.label.toLowerCase()} to new businesses. We’ll talk through what you need and tell you when it can be set up for you.`;
}

/**
 * The Dialer's few discovery questions. All optional, in the visitor's words rather than
 * telephony terms; enough for a first conversation and a rough quote, not a pricing questionnaire.
 */
export const DIALER_QUESTIONS = {
  callers: {
    name: 'dialerCallers',
    label: 'How many people would make or take calls?',
    summary: 'People on calls',
    options: ['Just me', '2 to 5', '6 to 20', 'More than 20'],
  },
  numbers: {
    name: 'dialerNumbers',
    label: 'Phone numbers',
    summary: 'Phone numbers',
    options: ['One number the team shares', 'A number for each person', 'Not sure yet'],
  },
  direction: {
    name: 'dialerDirection',
    label: 'Which calls?',
    summary: 'Calls',
    options: ['Making calls', 'Taking calls', 'Both'],
  },
  volume: {
    name: 'dialerVolume',
    label: 'Roughly how many calls a week?',
    summary: 'Calls a week',
    maxLength: 100,
  },
  extras: {
    name: 'dialerExtras',
    label: 'Also interested in',
    summary: 'Also interested in',
    options: ['Conference calls', 'Call recording', 'AI answering'],
  },
} as const;

type FormValues = Pick<FormData, 'get' | 'getAll'>;

function chosen(form: FormValues, name: string, options: readonly string[]): string | null {
  const value = form.get(name);
  return typeof value === 'string' && options.includes(value) ? value : null;
}

/**
 * The Dialer answers as one line for the CRM, e.g.
 * `People on calls: 2 to 5; Phone numbers: A number for each person; Calls: Both`.
 * Empty when nothing was answered.
 */
export function dialerNeeds(form: FormValues): string {
  const { callers, numbers, direction, volume, extras } = DIALER_QUESTIONS;
  const parts: string[] = [];

  for (const question of [callers, numbers, direction]) {
    const answer = chosen(form, question.name, question.options);
    if (answer) parts.push(`${question.summary}: ${answer}`);
  }

  const weekly = form.get(volume.name);
  if (typeof weekly === 'string' && weekly.trim().length > 0) {
    parts.push(`${volume.summary}: ${weekly.trim().replace(/\s+/g, ' ').slice(0, volume.maxLength)}`);
  }

  const ticked = extras.options.filter((option) => form.getAll(extras.name).includes(option));
  if (ticked.length > 0) parts.push(`${extras.summary}: ${ticked.join(', ')}`);

  return parts.join('; ');
}

/** What a topic adds to the inquiry: today only the Dialer asks its own questions. */
export function topicNeeds(topic: InquiryTopic | null, form: FormValues): string {
  return topic?.value === 'dialer' ? dialerNeeds(form) : '';
}
