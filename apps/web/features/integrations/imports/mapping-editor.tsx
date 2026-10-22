import { Section, SectionHeading } from '@/components/surfaces/section';
import { ErrorText, Hint, SelectInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
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
  return (
    <>
      <Hint className="mt-2">
        {totalRows} row{totalRows === 1 ? '' : 's'} detected. Each becomes a CRM contact. New contacts default to Lead / Unrated unless mapped. GildOps has
        guessed a mapping below — check it before continuing; nothing is written yet.
      </Hint>
      {error ? <ErrorText className="mt-2">{error}</ErrorText> : null}

      <Section className="mt-6">
        <SectionHeading>Columns</SectionHeading>
        <form action={createMappingAndStageAction} className="mt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="resourceId" value={resourceId} />

          <fieldset className="mb-4 flex flex-wrap items-end gap-3">
            <legend className="mb-2 font-medium">CRM intake</legend>
            <label>Contact type<SelectInput name="contactType" defaultValue=""><option value="">Map a column / Unspecified if absent</option><option value="person">All rows are People</option><option value="company">All rows are Companies</option></SelectInput></label>
            <label>Mode<SelectInput name="mode" defaultValue="import"><option value="import">Import once</option>{maySynchronize ? <option value="sync">Keep synchronized (manual review)</option> : null}</SelectInput></label>
            <label>Duplicate matching<SelectInput name="dedupeKey" defaultValue="email"><option value="email">Stable source ID, then email</option><option value="">Stable source ID only</option></SelectInput></label>
            <Hint>Updates are reviewed before applying. Local edits are preserved on conflicts. Removed source rows never delete contacts. Automatic CRM scheduling is not enabled.</Hint>
          </fieldset>
          <div className="@container overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">Source column</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Example value</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Maps to</th>
                  <th scope="col" className="py-2 font-medium">Transform</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header, index) => {
                  const field = suggested[index];
                  const example = sample[0]?.[header] ?? '';
                  return (
                    <tr key={header} className="border-b border-border/50">
                      <td className="py-2 pr-4 align-top font-medium">
                        {header}
                        <input type="hidden" name="header" value={header} />
                      </td>
                      <td className="py-2 pr-4 align-top text-muted">{example || '—'}</td>
                      <td className="py-2 pr-4 align-top">
                        <SelectInput name={`target_${index}`} size="small" defaultValue={targetValue(field.target)}>
                          <option value="ignore">Ignore this column</option>
                          <option value="core:name">Contact → Name</option>
                          <option value="core:email">Contact → Email</option>
                          <option value="core:contact_type">Contact type (Person / Company / Unspecified)</option>
                          <option value="core:company_contact_id">Affiliation company contact ID</option><option value="core:affiliation_title">Affiliation role or title</option>
                          <option value="core:lifecycle">Contact lifecycle</option>
                          <option value="core:lead_temperature">Lead temperature</option>
                          <option value="core:phone">Contact → Phone</option>
                          <option value="location:address">Location → Address</option>
                          <option value="location:city">Location → City</option>
                          <option value="location:province">Location → Province</option>
                          {definitions.length > 0 ? (
                            <optgroup label="Custom fields">
                              {definitions.map((definition) => (
                                <option key={definition.key} value={`custom:${definition.key}`}>
                                  Custom → {definition.label}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </SelectInput>
                      </td>
                      <td className="py-2 align-top">
                        <SelectInput name={`transform_${index}`} size="small" defaultValue={field.transform}>
                          <option value="none">None</option>
                          <option value="trim_lowercase">Lowercase</option>
                          <option value="e164">Phone number</option>
                          <option value="url">Website address</option>
                          <option value="integer">Whole number</option>
                        </SelectInput>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Hint className="mt-4">
            Worksheet imports match stable provider row IDs within the selected resource. For CSV updates, supply a source_record_id column; otherwise matching uses email when selected, or unchanged row content within the same filename. Email is optional. Unmapped source metadata stays
            with the import; historical contact dates do not create call activity.
          </Hint>

          <Button type="submit" tone="primary" className="mt-4">
            Review import
          </Button>
        </form>
      </Section>
    </>
  );
}
