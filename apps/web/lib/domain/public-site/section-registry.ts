import type { SectionKind, SectionOf } from '@gold/schemas';

/**
 * The one list of what a website page can hold. Each definition says what a kind is called, how it
 * is chosen, and what a fresh one looks like; the schema (`@gold/schemas`), the renderer
 * (`features/public-site/section-renderers.tsx`) and the editor (`features/studio/website/section-editors.tsx`)
 * are maps keyed by the same kinds, so adding one is a bounded change the compiler walks you
 * through — define the schema, add the defaults here, write the renderer and the editor, then test.
 *
 * Nothing here is React and nothing here decides what a business may place: cardinality is advice
 * (`recommendedOnce`), never a rule, because nothing in the domain requires exactly one of anything.
 */

export type SectionGroup = 'Hero' | 'Content' | 'Features' | 'Process' | 'Social proof' | 'Forms' | 'Calls to action';

export type SectionReference = { formId: string; name: string };

export type SectionDefinition<K extends SectionKind> = {
  kind: K;
  label: string;
  description: string;
  group: SectionGroup;
  /** Presentation variants of the same semantic section; the first is the default. */
  variants?: readonly { value: string; label: string }[];
  /** Advice shown in the chooser, not a constraint. */
  recommendedOnce?: boolean;
  /** What the chooser must ask for before it can make one. */
  reference?: 'form';
  create: (id: string, reference?: SectionReference) => SectionOf<K>;
};

export const SECTION_REGISTRY: { [K in SectionKind]: SectionDefinition<K> } = {
  hero: {
    kind: 'hero', label: 'Hero', group: 'Hero', recommendedOnce: true,
    description: 'A headline, a sentence and the one action you most want a visitor to take.',
    variants: [
      { value: 'centered', label: 'Centered' },
      { value: 'left', label: 'Left-aligned' },
      { value: 'preview', label: 'With a product preview' },
    ],
    create: (id) => ({
      id, kind: 'hero', variant: 'centered', eyebrow: '', heading: 'Say what you do in one line',
      body: 'A short paragraph on who it is for and why it matters.',
      primaryCta: { label: 'Get in touch', href: '/contact' },
    }),
  },
  content: {
    kind: 'content', label: 'Text', group: 'Content',
    description: 'A heading and a few paragraphs of plain text.',
    create: (id) => ({ id, kind: 'content', eyebrow: '', heading: 'A heading', paragraphs: ['Write in plain words.'] }),
  },
  problem: {
    kind: 'problem', label: 'Problem', group: 'Content',
    description: 'Name the problem your customers have, in a few short paragraphs.',
    create: (id) => ({ id, kind: 'problem', heading: 'The problem your customers have', paragraphs: ['Describe it the way they would.'] }),
  },
  capabilities: {
    kind: 'capabilities', label: 'Services', group: 'Features',
    description: 'Up to nine cards: what you offer, with a line on each.',
    create: (id) => ({
      id, kind: 'capabilities', eyebrow: '', heading: 'What we do', body: 'One card for each kind of work.',
      items: [{ title: 'First service', body: 'A sentence about it.' }, { title: 'Second service', body: 'A sentence about it.' }],
    }),
  },
  process: {
    kind: 'process', label: 'Steps', group: 'Process',
    description: 'Numbered steps from first contact to finished work.',
    create: (id) => ({
      id, kind: 'process', eyebrow: '', heading: 'How it works',
      items: [{ step: '01', title: 'First step', body: 'What happens.' }, { step: '02', title: 'Second step', body: 'What happens.' }],
    }),
  },
  trust: {
    kind: 'trust', label: 'Reasons to trust you', group: 'Social proof',
    description: 'A few short reasons a customer can rely on you.',
    create: (id) => ({
      id, kind: 'trust', eyebrow: '', heading: 'What you can rely on',
      items: [{ title: 'First reason', body: 'Say it plainly.' }, { title: 'Second reason', body: 'Say it plainly.' }],
    }),
  },
  form: {
    kind: 'form', label: 'Form', group: 'Forms', reference: 'form',
    description: 'One of your Studio forms, with a few words around it. The questions stay in the form.',
    create: (id, reference) => {
      if (!reference) throw new Error('A form section needs a form.');
      return { id, kind: 'form', heading: reference.name, body: '', formId: reference.formId };
    },
  },
  cta: {
    kind: 'cta', label: 'Closing action', group: 'Calls to action', recommendedOnce: true,
    description: 'A last call to action at the foot of a page.',
    create: (id) => ({
      id, kind: 'cta', heading: 'Ready when you are', body: 'Tell us what you need.',
      primaryCta: { label: 'Contact us', href: '/contact' },
    }),
  },
};

export function sectionLabel(kind: SectionKind): string {
  return SECTION_REGISTRY[kind].label;
}

export const SECTION_GROUPS: SectionGroup[] = ['Hero', 'Content', 'Features', 'Process', 'Social proof', 'Forms', 'Calls to action'];
