import { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, classificationLabel } from '@/lib/domain/customers/classification';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { CollectionToolbar, type ActiveFilter } from '@/components/patterns/collection-toolbar';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import { SelectField } from '@/components/controls/select-field';

export type CustomerDirectoryView = {
  search: string;
  contactType?: string;
  companyId?: string;
  sort?: string;
  group?: string;
  lifecycle?: string;
  temperature?: string;
  stage: string;
  industry: string;
  website: string;
  /** `30d`: created in the last 30 days, the CRM Dashboard's New contacts window. */
  added?: string;
  /** `1`: Needs review — Unspecified identity or no lifecycle yet. */
  review?: string;
  /** `1`: archived contacts, where they are found and restored. */
  archived?: string;
  optional: string[];
};

const KEYS = ['contactType', 'review', 'companyId', 'sort', 'group', 'lifecycle', 'temperature', 'stage', 'industry', 'website', 'added', 'archived'] as const;

/** The directory address for this view with some values replaced or removed — the one place the URL view model is written. */
export function directoryHref(organizationId: string, view: CustomerDirectoryView, overrides: Partial<Record<keyof CustomerDirectoryView | 'page', string | undefined>> = {}) {
  const params = new URLSearchParams();
  const merged: Record<string, string | string[] | undefined> = { ...view, ...overrides };
  if (merged.search) params.set('q', String(merged.search));
  for (const key of KEYS) { const value = merged[key]; if (typeof value === 'string' && value) params.set(key, value); }
  for (const id of view.optional) params.append('column', id);
  if (overrides.page && overrides.page !== '1') params.set('page', overrides.page);
  const text = params.toString();
  return `/organizations/${organizationId}/crm/contacts${text ? `?${text}` : ''}`;
}

/**
 * The directory's controls: quick scopes (All, People, Companies, Needs review) and search first,
 * then sort and display, with the less frequent criteria inside Filters. Active filters show as
 * removable chips. A plain GET form over the URL view model, so the database stays the one filter
 * engine and counts and pagination always agree with the rows.
 */
export function CustomerListToolbar({ organizationId, stages, industries, choices, view, companies = [] }: {
  organizationId: string;
  stages: CustomerStage[];
  /** Industry values recorded in this business's own field options. */
  industries: string[];
  choices: { id: string; label: string }[];
  view: CustomerDirectoryView;
  companies?: { id: string; name: string }[];
}) {
  const href = (overrides: Parameters<typeof directoryHref>[2]) => directoryHref(organizationId, view, overrides);
  const scope = view.review === '1' ? 'review' : view.contactType ?? 'all';
  const scopes = [
    { key: 'all', label: 'All', href: href({ contactType: undefined, review: undefined }) },
    { key: 'person', label: 'People', href: href({ contactType: 'person', review: undefined }) },
    { key: 'company', label: 'Companies', href: href({ contactType: 'company', review: undefined }) },
    { key: 'review', label: 'Needs review', href: href({ contactType: undefined, review: '1' }) },
  ].map(item => ({ ...item, current: item.key === scope }));
  const stageName = new Map(stages.map(stage => [stage.id, stage.name]));
  const labels: [keyof CustomerDirectoryView, string, (value: string) => string][] = [
    ['lifecycle', 'Lifecycle', value => classificationLabel(value)],
    ['temperature', 'Temperature', value => classificationLabel(value)],
    ['companyId', 'Company', value => companies.find(company => company.id === value)?.name ?? 'Company'],
    ['stage', 'Relationship', value => value === 'unstaged' ? 'No stage' : stageName.get(value) ?? 'Stage'],
    ['industry', 'Industry', value => value],
    ['website', 'Website', value => value === 'with' ? 'Has a website' : 'No website'],
    ['added', 'Added', () => 'Last 30 days'],
    ['archived', 'Status', () => 'Archived'],
  ];
  const active: ActiveFilter[] = [
    ...(view.search ? [{ key: 'search', label: `Search: ${view.search}`, removeHref: href({ search: '' }) }] : []),
    ...labels.filter(([key]) => view[key]).map(([key, label, show]) => ({ key, label: `${label}: ${show(String(view[key]))}`, removeHref: href({ [key]: undefined }) })),
  ];
  return (
    <CollectionToolbar
      action={`/organizations/${organizationId}/crm/contacts`}
      scopes={scopes} scopeLabel="Contact views"
      search={{ name: 'q', value: view.search, label: 'Search contacts' }}
      hidden={{ contactType: view.contactType, review: view.review }}
      filterCount={labels.filter(([key]) => view[key]).length}
      filters={<>
        <label className="flex flex-col gap-1 text-sm">Lifecycle<SelectField name="lifecycle" aria-label="Filter by lifecycle" defaultValue={view.lifecycle ?? ''} options={[{ value: '', label: 'Any lifecycle' }, { value: 'unclassified', label: 'Unclassified' }, ...CONTACT_LIFECYCLES.map((value) => ({ value: value, label: classificationLabel(value) }))]} /></label>
        <label className="flex flex-col gap-1 text-sm">Lead temperature<SelectField name="temperature" aria-label="Filter by temperature" defaultValue={view.temperature ?? ''} options={[{ value: '', label: 'Any temperature' }, ...LEAD_TEMPERATURES.map((value) => ({ value: value, label: classificationLabel(value) }))]} /></label>
        <label className="flex flex-col gap-1 text-sm">Company<SelectField name="companyId" aria-label="Filter by company" defaultValue={view.companyId ?? ''} options={[{ value: '', label: 'Any company' }, ...companies.map((company) => ({ value: company.id, label: company.name }))]} /></label>
        {stages.length > 0 ? <label className="flex flex-col gap-1 text-sm">Relationship stage<SelectField name="stage" aria-label="Filter by relationship" defaultValue={view.stage} options={[{ value: '', label: 'Any stage' }, { value: 'unstaged', label: 'No relationship stage' }, ...stages.map((item) => ({ value: item.id, label: item.name }))]} /></label> : null}
        {industries.length > 0 ? <label className="flex flex-col gap-1 text-sm">Industry<SelectField name="industry" aria-label="Filter by industry" defaultValue={view.industry} options={[{ value: '', label: 'Any industry' }, ...industries.map((item) => ({ value: item, label: item }))]} /></label> : null}
        <label className="flex flex-col gap-1 text-sm">Website<SelectField name="website" aria-label="Filter by website" defaultValue={view.website} options={[{ value: '', label: 'Any website' }, { value: 'with', label: 'Has a website' }, { value: 'without', label: 'No website' }]} /></label>
        <label className="flex flex-col gap-1 text-sm">Added<SelectField name="added" aria-label="Filter by date added" defaultValue={view.added ?? ''} options={[{ value: '', label: 'Any time' }, { value: '30d', label: 'In the last 30 days' }]} /></label>
        <label className="flex flex-col gap-1 text-sm">Status<SelectField name="archived" aria-label="Filter by status" defaultValue={view.archived ?? ''} options={[{ value: '', label: 'Active' }, { value: '1', label: 'Archived' }]} /></label>
      </>}
      sort={<SelectField name="sort" aria-label="Sort contacts" defaultValue={view.sort ?? ''} className="w-full md:w-40" options={[{ value: '', label: 'Newest first' }, { value: 'name', label: 'Name' }, { value: 'company', label: 'Company' }]} />}
      display={<>
        <SelectField name="group" aria-label="Contact grouping" defaultValue={view.group ?? ''} className="w-full md:w-44" options={[{ value: '', label: 'Flat list' }, { value: 'company', label: 'Group by company' }]} />
        {choices.length > 0 ? <details className="relative">
          <summary className="flex min-h-[var(--control-height,2.25rem)] cursor-pointer list-none items-center rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface px-3 text-sm font-medium hover:bg-hover [&::-webkit-details-marker]:hidden">Columns{view.optional.length > 0 ? ` (${view.optional.length})` : ''}</summary>
          <fieldset className="z-30 mt-2 grid gap-2 rounded-[var(--visual-radius,0.625rem)] border border-border bg-popover p-3 shadow-[var(--visual-overlay-shadow)] sm:grid-cols-2 md:absolute md:right-0 md:w-80">
            <legend className="sr-only">Optional columns</legend>
            {choices.map(choice => <CheckboxField key={choice.id} id={`column-${choice.id.replace(':', '-')}`} name="column" value={choice.id} label={choice.label} defaultChecked={view.optional.includes(choice.id)} />)}
          </fieldset>
        </details> : null}
      </>}
      active={active}
      resetHref={active.length ? directoryHref(organizationId, { search: '', stage: '', industry: '', website: '', optional: view.optional }, { contactType: view.contactType, review: view.review }) : undefined}
    />
  );
}
