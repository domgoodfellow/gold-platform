import { Section, SectionHeading } from '@/components/containers/section';
import { ErrorText, Hint, SelectInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { MappingField, MappingTarget } from '@/lib/domain/integrations/mappings';
import { createMappingAndStageAction } from '@/app/organizations/[organizationId]/integrations/imports/new/actions';

function targetValue(target: MappingTarget): string {
  if (target.kind === 'core') return `core:${target.field}`;
  if (target.kind === 'custom') return `custom:${target.key}`;
  return 'ignore';
}

/**
 * Real product behaviour, not a form helper: source field → GOLD Customer/core/custom field, one
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
}: {
  organizationId: string;
  resourceId: string;
  headers: string[];
  sample: Record<string, string>[];
  totalRows: number;
  suggested: MappingField[];
  definitions: FieldDefinition[];
  error?: string;
}) {
  return (
    <>
      <Hint className="mt-2">
        {totalRows} row{totalRows === 1 ? '' : 's'} detected. Each becomes a Customer. GOLD has
        guessed a mapping below — check it before continuing; nothing is written yet.
      </Hint>
      {error ? <ErrorText className="mt-2">{error}</ErrorText> : null}

      <Section className="mt-6">
        <SectionHeading>Columns</SectionHeading>
        <form action={createMappingAndStageAction} className="mt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="resourceId" value={resourceId} />

          <div className="@container">
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
                          <option value="core:name">Customer → Name</option>
                          <option value="core:email">Customer → Email</option>
                          <option value="core:phone">Customer → Phone</option>
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
            Rows are matched to an existing customer by email — a row whose email is already a
            customer here updates that customer instead of creating a second one.
          </Hint>

          <Button type="submit" tone="primary" className="mt-4">
            Review import
          </Button>
        </form>
      </Section>
    </>
  );
}
