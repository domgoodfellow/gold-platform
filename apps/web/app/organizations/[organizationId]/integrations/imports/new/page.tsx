import { Section, SectionHeading } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { areaLabel } from '@/lib/navigation';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { SelectInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { suggestMapping, type MappingTarget } from '@/lib/domain/integrations/mappings';
import { downloadCsvResource } from '@/lib/domain/integrations/resources';
import { requireOrganization } from '@/lib/route/organization';
import { UploadSourceForm } from './upload-form';
import { createMappingAndStageAction } from './actions';

export const dynamic = 'force-dynamic';

function targetValue(target: MappingTarget): string {
  if (target.kind === 'core') return `core:${target.field}`;
  if (target.kind === 'custom') return `custom:${target.key}`;
  return 'ignore';
}

export default async function NewImportPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/integrations/imports/new'>) {
  const { organizationId } = await params;
  const { resourceId, error } = await searchParams;
  const { db } = await requireOrganization(organizationId);

  if (typeof resourceId !== 'string') {
    return (
      <>
        <PageHeader title="Import customers" crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/integrations` }]} description="Upload a CSV export. GOLD reads the header row and shows you a mapping to review before anything is written." />
        <UploadSourceForm organizationId={organizationId} />
      </>
    );
  }

  const source = await downloadCsvResource(db, { organizationId, resourceId });
  if (!source) {
    return <Hint className="mt-6">That file is no longer available. Upload it again.</Hint>;
  }

  const definitions = await listFieldDefinitions(db, { organizationId, entityType: 'customer' });
  const suggested = suggestMapping(source.headers, definitions);

  return (
    <>
      <PageHeader title="Map your columns" crumbs={[{ label: areaLabel('integrations'), href: `/organizations/${organizationId}/integrations` }]} />
      <Hint className="mt-2">
        {source.totalRows} row{source.totalRows === 1 ? '' : 's'} detected. Each becomes a
        Customer. GOLD has guessed a mapping below — check it before continuing; nothing is
        written yet.
      </Hint>
      {typeof error === 'string' ? <ErrorText className="mt-2">{error}</ErrorText> : null}

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
                {source.headers.map((header, index) => {
                  const field = suggested[index];
                  const example = source.sample[0]?.[header] ?? '';
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
