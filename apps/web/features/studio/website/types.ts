/** A form the website may place: one the business owns and has not archived. */
export type FormOption = { id: string; name: string; published: boolean };

/** What the inspector shows: the current page, or one section of it. */
export type Selection = 'page' | { sectionId: string };

export function isSection(selection: Selection): selection is { sectionId: string } {
  return selection !== 'page';
}
