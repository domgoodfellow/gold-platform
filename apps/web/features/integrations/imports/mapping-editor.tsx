import { Card } from '@/components/surfaces/card';
import { FormField } from '@/components/controls/form';
import { libraryNewImportHref } from '@/lib/route/library';
import { ErrorText, Hint, SelectInput } from '@/components/controls/inputs';
import { Button, ButtonLink } from '@/components/controls/button';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { MappingField, MappingTarget } from '@/lib/domain/integrations/mappings';
import { createMappingAndStageAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';

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
        <p className="mt-0.5 text-sm text-muted">Person and Company are kept apart. Rows without a type become Unspecified / Needs classification; GildOps never guesses it from a name.</p>
        <div data-slot="field-group" className="mt-3 grid gap-3 md:grid-cols-3">
          <FormField id="mapping-contact-type" label="Contact type">{field => <SelectInput {...field} name="contactType" defaultValue=""><option value="">Use a mapped column (otherwise Unspecified)</option><option value="person">All rows are People</option><option value="company">All rows are Companies</option></SelectInput>}</FormField>
          <FormField id="mapping-mode" label="How often">{field => <SelectInput {...field} name="mode" defaultValue="import"><option value="import">Import once</option>{maySynchronize ? <option value="sync">Keep synchronized (review each refresh)</option> : null}</SelectInput>}</FormField>
          <FormField id="mapping-dedupe" label="Duplicate matching">{field => <SelectInput {...field} name="dedupeKey" defaultValue="email"><option value="email">Stable source ID, then email</option><option value="">Stable source ID only</option></SelectInput>}</FormField>
        </div>
        <Hint className="mt-3 block">New contacts are Lead / Unrated unless a lifecycle or temperature column is mapped. {maySynchronize ? 'A synchronized worksheet is reviewed on every refresh: local edits are kept on conflicts and removed rows never delete contacts. Automatic scheduling is not enabled.' : 'Updates to contacts this source created before are reviewed like new rows.'}</Hint>
      </Card>

      <Card as="section" aria-labelledby="mapping-columns" className="p-0 py-0">
        <div className="px-4 pt-4"><h2 id="mapping-columns" className="text-sm font-semibold">Columns</h2>
          <p className="mt-0.5 text-sm text-muted">Ignored columns are not written to contacts; they stay with the import&apos;s source data.</p></div>
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
                      <SelectInput aria-label={`Destination for ${header}`} name={`target_${index}`} size="small" defaultValue={targetValue(field.target)}>
                        <option value="ignore">Ignore this column</option>
                        <optgroup label="Contact">
                          <option value="core:name">Name</option><option value="core:email">Email</option><option value="core:phone">Phone</option>
                          <option value="core:contact_type">Contact type (Person / Company / Unspecified)</option>
                          <option value="core:lifecycle">Lifecycle</option><option value="core:lead_temperature">Lead temperature</option>
                        </optgroup>
                        <optgroup label="Company affiliation">
                          <option value="core:company_contact_id">Company contact ID</option><option value="core:affiliation_title">Role or title</option>
                        </optgroup>
                        <optgroup label="Location">
                          <option value="location:address">Address</option><option value="location:city">City</option><option value="location:province">Province</option>
                        </optgroup>
                        {definitions.length > 0 ? <optgroup label="Custom fields">{definitions.map(definition => <option key={definition.key} value={`custom:${definition.key}`}>{definition.label}</option>)}</optgroup> : null}
                      </SelectInput>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <SelectInput aria-label={`Transformation for ${header}`} name={`transform_${index}`} size="small" defaultValue={field.transform}>
                        <option value="none">None</option><option value="trim_lowercase">Lowercase</option><option value="e164">Phone number</option>
                        <option value="url">Website address</option><option value="integer">Whole number</option>
                      </SelectInput>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Hint className="block px-4 py-3">
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
