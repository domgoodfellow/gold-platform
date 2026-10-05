import type { PublicHomepageSection, PublicHomepageSections } from '@gold/schemas';

/** A form the website may place: one the business owns and has not archived. */
export type FormOption = { id: string; name: string; published: boolean };

/** The form section is the one optional section, and it sits immediately before the closing action. */
const FORM_SECTION_INDEX = 5;

export function formSectionOf(sections: PublicHomepageSections): Extract<PublicHomepageSection, { kind: 'form' }> | null {
  const found = sections.find((section) => section.kind === 'form');
  return found?.kind === 'form' ? found : null;
}

/** Adds the form section for `form`, or does nothing when there is one already. The words around it are the business's to change. */
export function addFormSection(sections: PublicHomepageSections, form: FormOption): PublicHomepageSections {
  if (formSectionOf(sections)) return sections;
  const section: PublicHomepageSection = { kind: 'form', heading: form.name, body: '', formId: form.id };
  return [...sections.slice(0, FORM_SECTION_INDEX), section, ...sections.slice(FORM_SECTION_INDEX)] as PublicHomepageSections;
}

export function removeFormSection(sections: PublicHomepageSections): PublicHomepageSections {
  return sections.filter((section) => section.kind !== 'form') as PublicHomepageSections;
}
