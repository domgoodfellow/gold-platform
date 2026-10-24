import { CONTACT_LIFECYCLES, LEAD_TEMPERATURES, classificationLabel } from '@/lib/domain/customers/classification';
import { Search } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import type { CustomerStage } from '@/lib/domain/customers/stages';

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
  optional: string[];
};

/**
 * Filters and optional columns, submitted as a plain GET form so the view lives in the URL.
 * Changing a filter or a column starts again at page one: the form carries no `page`.
 */
export function CustomerListToolbar({
  organizationId,
  stages,
  industries,
  choices,
  view,
  companies=[],
}: {
  organizationId: string;
  stages: CustomerStage[];
  /** Industry values recorded in this business's own field options. */
  industries: string[];
  choices: { id: string; label: string }[];
  view: CustomerDirectoryView;
  companies?: {id:string;name:string}[];
}) {
  const filtered = Boolean(view.contactType || view.companyId || view.lifecycle || view.temperature || view.search || view.stage || view.industry || view.website || view.added);
  return (
    <form className="flex flex-col gap-2" role="search">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <TextInput name="q" defaultValue={view.search} placeholder="Search contacts" aria-label="Search contacts" className="w-full pl-9" />
        </div>
        <SelectInput name="contactType" aria-label="Contact type view" defaultValue={view.contactType ?? ''} className="w-full sm:w-40"><option value="">All contacts</option><option value="company">Companies</option><option value="person">People</option><option value="unspecified">Needs classification</option></SelectInput>
        <SelectInput name="companyId" aria-label="Filter by company" defaultValue={view.companyId ?? ''} className="w-full sm:w-48"><option value="">All companies</option>{companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</SelectInput>
        <SelectInput name="sort" aria-label="Sort contacts" defaultValue={view.sort ?? ''} className="w-full sm:w-40"><option value="">Newest first</option><option value="name">Name</option><option value="company">Company</option></SelectInput>
        <SelectInput name="group" aria-label="Contact grouping" defaultValue={view.group ?? ''} className="w-full sm:w-40"><option value="">Flat list</option><option value="company">Group by company</option></SelectInput>
        <SelectInput name="lifecycle" defaultValue={view.lifecycle ?? ''} aria-label="Filter by lifecycle" className="w-full sm:w-40">
          <option value="">All lifecycles</option><option value="unclassified">Unclassified</option>
          {CONTACT_LIFECYCLES.map(value => <option key={value} value={value}>{classificationLabel(value)}</option>)}
        </SelectInput>
        <SelectInput name="temperature" defaultValue={view.temperature ?? ''} aria-label="Filter by temperature" className="w-full sm:w-40">
          <option value="">All temperatures</option>{LEAD_TEMPERATURES.map(value => <option key={value} value={value}>{classificationLabel(value)}</option>)}
        </SelectInput>
        {stages.length > 0 ? (
          <SelectInput name="stage" defaultValue={view.stage} aria-label="Filter by relationship" className="w-full sm:w-48">
            <option value="">All relationships</option>
            <option value="unstaged">No relationship stage</option>
            {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SelectInput>
        ) : null}
        {industries.length > 0 ? (
          <SelectInput name="industry" defaultValue={view.industry} aria-label="Filter by industry" className="w-full sm:w-44">
            <option value="">All industries</option>
            {industries.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectInput>
        ) : null}
        <SelectInput name="website" defaultValue={view.website} aria-label="Filter by website" className="w-full sm:w-40">
          <option value="">Any website</option>
          <option value="with">Has a website</option>
          <option value="without">No website</option>
        </SelectInput>
        <SelectInput name="added" defaultValue={view.added ?? ''} aria-label="Filter by date added" className="w-full sm:w-44">
          <option value="">Added any time</option>
          <option value="30d">Added in the last 30 days</option>
        </SelectInput>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" tone="secondary">Apply</Button>
        {filtered || view.optional.length > 0 ? (
          <ButtonLink href={`/organizations/${organizationId}/crm/contacts`} tone="text">Clear</ButtonLink>
        ) : null}
        {choices.length > 0 ? (
          <details className="ml-auto">
            <summary className="cursor-pointer text-sm font-medium">
              Columns{view.optional.length > 0 ? ` (${view.optional.length} more)` : ''}
            </summary>
            <fieldset className="mt-2 grid gap-2 rounded border border-border p-3 sm:grid-cols-2">
              <legend className="sr-only">Optional columns</legend>
              {choices.map((choice) => (
                <CheckboxField
                  key={choice.id}
                  id={`column-${choice.id.replace(':', '-')}`}
                  name="column"
                  value={choice.id}
                  label={choice.label}
                  defaultChecked={view.optional.includes(choice.id)}
                />
              ))}
            </fieldset>
          </details>
        ) : null}
      </div>
    </form>
  );
}
