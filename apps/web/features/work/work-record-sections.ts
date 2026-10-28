/**
 * The Work record's five sections, each with its own address (`?section=…`; Overview is the bare
 * record address), in the same model as the contact record's. The record's former tabs had the
 * same names, so an old `?tab=` link — Finance's `?tab=financials` above all — opens the same
 * section. Anything else falls back to Overview.
 */
export const WORK_SECTIONS = ['overview', 'execution', 'financials', 'documents', 'activity'] as const;
export type WorkSection = (typeof WORK_SECTIONS)[number];
export const WORK_SECTION_LABELS: Record<WorkSection, string> = { overview: 'Overview', execution: 'Execution', financials: 'Financials', documents: 'Documents', activity: 'Activity' };

const isSection = (value: unknown): value is WorkSection => typeof value === 'string' && (WORK_SECTIONS as readonly string[]).includes(value);

export function resolveWorkSection(query: { section?: unknown; tab?: unknown }): WorkSection {
  if (isSection(query.section)) return query.section;
  if (isSection(query.tab)) return query.tab;
  return 'overview';
}

export function workSectionHref(organizationId: string, workItemId: string, section: WorkSection): string {
  const base = `/organizations/${organizationId}/work/${workItemId}`;
  return section === 'overview' ? base : `${base}?section=${section}`;
}
