/**
 * The contact record's destinations: seven top-level sections, each with its own sub-sections, all
 * URL-backed (`?section=…&view=…`). `LEGACY_TABS` maps every former peer tab onto its new place so
 * an old `?tab=` link still opens the same content. Availability is decided by the caller from
 * permissions and capabilities; this file only knows the shape.
 */
export type RecordSection = 'overview' | 'sales' | 'tasks' | 'activity' | 'related' | 'documents' | 'portal';
export type RecordView =
  | 'opportunities' | 'discovery' | 'configuration' | 'commercial' | 'invoices'
  | 'timeline' | 'calls'
  | 'work' | 'locations' | 'support' | 'services';

export const SECTION_LABELS: Record<RecordSection, string> = { overview: 'Overview', sales: 'Sales', tasks: 'Tasks', activity: 'Activity', related: 'Related', documents: 'Documents', portal: 'Portal' };
export const VIEW_LABELS: Record<RecordView, string> = {
  opportunities: 'Opportunities', discovery: 'Discovery', configuration: 'Proposed setup', commercial: 'Commercial proposals', invoices: 'Invoices',
  timeline: 'Timeline', calls: 'Calls', work: 'Work', locations: 'Locations', support: 'Support cases', services: 'Services',
};
export const SECTION_VIEWS: Record<RecordSection, readonly RecordView[]> = {
  overview: [], sales: ['opportunities', 'discovery', 'configuration', 'commercial', 'invoices'], tasks: [],
  activity: ['timeline', 'calls'], related: ['work', 'locations', 'support', 'services'], documents: [], portal: [],
};

/** Every tab the record had before V1.4, and where its content lives now. */
export const LEGACY_TABS: Record<string, { section: RecordSection; view?: RecordView }> = {
  overview: { section: 'overview' }, opportunities: { section: 'sales', view: 'opportunities' }, 'follow-ups': { section: 'tasks' },
  discovery: { section: 'sales', view: 'discovery' }, configuration: { section: 'sales', view: 'configuration' }, commercial: { section: 'sales', view: 'commercial' },
  invoices: { section: 'sales', view: 'invoices' }, activity: { section: 'activity', view: 'timeline' }, calls: { section: 'activity', view: 'calls' },
  work: { section: 'related', view: 'work' }, locations: { section: 'related', view: 'locations' }, support: { section: 'related', view: 'support' },
  documents: { section: 'documents' }, portal: { section: 'portal' },
};

export type Availability = { sections: RecordSection[]; views: Partial<Record<RecordSection, RecordView[]>> };

/** Resolves the requested section and view against what this viewer may open, falling back predictably. */
export function resolveRecordLocation(query: { section?: string; view?: string; tab?: string }, available: Availability): { section: RecordSection; view?: RecordView } {
  const legacy = query.tab ? LEGACY_TABS[query.tab] : undefined;
  const wanted = (legacy?.section ?? query.section) as RecordSection | undefined;
  const section = wanted && available.sections.includes(wanted) ? wanted : 'overview';
  const views = available.views[section] ?? [];
  const requested = (legacy?.view ?? query.view) as RecordView | undefined;
  return { section, view: requested && views.includes(requested) ? requested : views[0] };
}

export function recordHref(base: string, section: RecordSection, view?: RecordView) {
  if (section === 'overview') return base;
  return `${base}?section=${section}${view ? `&view=${view}` : ''}`;
}
