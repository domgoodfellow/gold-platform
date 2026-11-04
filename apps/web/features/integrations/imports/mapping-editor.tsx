import { Card } from '@/components/surfaces/card';
import { CONTACT_LIFECYCLES, classificationLabel } from '@/lib/domain/customers/classification';
import { FormField } from '@/components/controls/form';
import { libraryNewImportHref } from '@/lib/route/library';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { Button, ButtonLink } from '@/components/controls/button';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { MappingField, MappingTarget } from '@/lib/domain/integrations/mappings';
import { createMappingAndStageAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';
import { SelectField } from '@/components/controls/select-field';

function targetValue(target: MappingTarget): string {
  if (target.kind === 'core') return `core:${target.field}`;
  if (target.kind === 'custom') return `custom:${target.key}`;
  if (target.kind === 'location') return `location:${target.field}`;
  return 'ignore';
}

/**
 * Real product behaviour, not a form helper: source field → GOLD Contact/core/custom field, one
 * row per source column, GOLD's own guess pre-selected and reviewed before anything is written.
 * Unrelated to the provider-service/connector-app → Catalog Feature mapping this same slice adds
 * elsewhere — the two share a word and nothing else (section 36).
 */
export function MappingEditor({
  organizationId,
  resourceId,
  headers,
  sample,
  totalRows,
  suggested,
  definitions,
  error,
  maySynchronize = false,
}: {
  organizationId: string;
  resourceId: string;
  headers: string[];
  sample: Record<string, string>[];
  totalRows: number;
  suggested: MappingField[];
  definitions: FieldDefinition[];
  error?: string;
  maySynchronize?: boolean;
}) {
  const samples = (header: string) => [...new Set(sample.map(row => row[header]?.trim()).filter(Boolean))].slice(0, 2);
  return (
    <form action={createMappingAndStageAction} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <p className="max-w-3xl text-sm text-muted">
        {totalRows} row{totalRows === 1 ? '' : 's'} found. GildOps has suggested a destination for each column; check them, then review the changes. Nothing is written yet.
      </p>
      {error ? <ErrorText role="alert">{error}</ErrorText> : null}

      <Card as="section" aria-labelledby="mapping-identity">
        <h2 id="mapping-identity" className="text-sm font-semibold">Who these rows are</h2>
        <div data-slot="field-group" className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FormField id="mapping-contact-type" label="Contact type" hint="Rows without a type become Unspecified / Needs classification; GildOps never guesses it from a name.">{field => <SelectField {...field} name="contactType" defaultValue="" options={[{ value: '', label: 'Use a mapped column (otherwise Unspecified)' }, { value: 'person', label: 'All rows are People' }, { value: 'company', label: 'All rows are Companies' }]} />}</FormField>
          <FormField id="mapping-mode" label="How often">{field => <SelectField {...field} name="mode" defaultValue="import" options={[{ value: 'import', label: 'Import once' }, ...(maySynchronize ? [{ value: 'sync', label: 'Keep synchronized (review each refresh)' }] : [])]} />}</FormField>
          <FormField id="mapping-default-lifecycle" label="Lifecycle for new contacts" hint="A mapped lifecycle column wins per row. Existing contacts keep theirs.">{field => <SelectField {...field} name="defaultLifecycle" defaultValue="" options={[{ value: '', label: 'Unclassified' }, ...CONTACT_LIFECYCLES.map((value) => ({ value: value, label: classificationLabel(value) }))]} />}</FormField>
          <FormField id="mapping-dedupe" label="Duplicate matching">{field => <SelectField {...field} name="dedupeKey" defaultValue="email" options={[{ value: 'email', label: 'Stable source ID, then email' }, { value: '', label: 'Stable source ID only' }]} />}</FormField>
        </div>
        <Hint className="mt-3 block">Lead temperature stays Unrated unless a column is mapped. {maySynchronize ? 'A synchronized worksheet is reviewed on every refresh: local edits are kept on conflicts and removed rows never delete contacts. Automatic scheduling is not enabled.' : 'Updates to contacts this source created before are reviewed like new rows.'}</Hint>
      </Card>

      <Card as="section" aria-labelledby="mapping-columns" className="p-0 py-0">
        <div className="px-4 pt-4"><h2 id="mapping-columns" className="text-sm font-semibold">Columns</h2></div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="border-y border-border bg-secondary/50 text-left text-xs text-muted">
              <th scope="col" className="px-4 py-2 font-medium">Source column</th><th scope="col" className="px-4 py-2 font-medium">Sample value</th>
              <th scope="col" className="px-4 py-2 font-medium">Destination field</th><th scope="col" className="px-4 py-2 font-medium">Transformation</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {headers.map((header, index) => {
                const field = suggested[index]; const examples = samples(header);
                return (
                  <tr key={header}>
                    <th scope="row" className="px-4 py-2 text-left align-top font-medium">{header}<input type="hidden" name="header" value={header} /></th>
                    <td className="max-w-48 px-4 py-2 align-top text-muted">{examples.length ? examples.map(value => <span key={value} className="block truncate">{value}</span>) : <span>No values in the sample</span>}</td>
                    <td className="px-4 py-2 align-top">
                      <SelectField aria-label={`Destination for ${header}`} name={`target_${index}`} size="small" defaultValue={targetValue(field.target)} options={[{ value: 'ignore', label: 'Ignore this column' }, { value: 'core:name', label: 'Name', group: 'Contact' }, { value: 'core:email', label: 'Email', group: 'Contact' }, { value: 'core:phone', label: 'Phone', group: 'Contact' }, { value: 'core:contact_type', label: 'Contact type (Person / Company / Unspecified)', group: 'Contact' }, { value: 'core:lifecycle', label: 'Lifecycle', group: 'Contact' }, { value: 'core:lead_temperature', label: 'Lead temperature', group: 'Contact' }, { value: 'core:company_contact_id', label: 'Company contact ID', group: 'Company affiliation' }, { value: 'core:affiliation_title', label: 'Role or title', group: 'Company affiliation' }, { value: 'location:address', label: 'Address', group: 'Location' }, { value: 'location:city', label: 'City', group: 'Location' }, { value: 'location:province', label: 'Province', group: 'Location' }, ...(definitions.length > 0 ? [...definitions.map((definition) => ({ value: `custom:${definition.key}`, label: definition.label, group: 'Custom fields' }))] : [])]} />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <SelectField aria-label={`Transformation for ${header}`} name={`transform_${index}`} size="small" defaultValue={field.transform} options={[{ value: 'none', label: 'None' }, { value: 'trim_lowercase', label: 'Lowercase' }, { value: 'e164', label: 'Phone number' }, { value: 'url', label: 'Website address' }, { value: 'integer', label: 'Whole number' }]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Hint className="block px-4 py-3">
          Ignored columns are not written to contacts; they stay with the import&apos;s source data.
          Worksheet imports match stable provider row IDs within the selected resource. For CSV updates, supply a source_record_id column; otherwise matching uses email when selected, or unchanged row content within the same filename. Historical contact dates do not create call activity.
        </Hint>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ButtonLink tone="secondary" href={libraryNewImportHref(organizationId)}>Choose a different source</ButtonLink>
        <Button type="submit" tone="primary">Review changes</Button>
      </div>
    </form>
  );
}
