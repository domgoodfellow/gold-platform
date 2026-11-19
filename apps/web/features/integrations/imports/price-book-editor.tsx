import { Card } from '@/components/surfaces/card';
import { FormField } from '@/components/controls/form';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectField } from '@/components/controls/select-field';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { PRICE_CONCEPTS, PRICE_CONCEPT_LABELS, type PriceBookInspection } from '@/lib/domain/integrations/translation/price-book';
import { libraryNewImportHref } from '@/lib/route/library';
import { createPriceBookImportAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';

/**
 * Step 2 of a price book import: which source column holds each item's name, price, unit,
 * currency and ID, the unit for rows that name none, and what the first rows become. Update
 * preview reads the source again with the chosen columns; Review changes saves the plan and
 * stages every row. Nothing is written to the price book here.
 */
export function PriceBookEditor({ organizationId, resourceId, inspection, error }: {
  organizationId: string;
  resourceId: string;
  inspection: PriceBookInspection;
  error?: string;
}) {
  const { columns, plan, summary, preview, currency } = inspection;
  const readable = columns.filter((column) => !column.sensitive);
  const count = (value: number, singular: string, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
  const issues = Object.entries(summary.issues).sort(([, a], [, b]) => b - a);
  return (
    <form action={createPriceBookImportAction} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <input type="hidden" name="into" value="price_book" />
      <p className="max-w-3xl text-sm text-muted">{count(inspection.rowCount, 'row')} read.{inspection.origin === 'saved' ? ' Choices from your last import of these columns are filled in.' : ''} Nothing is written yet.</p>
      {error ? <ErrorText role="alert">{error}</ErrorText> : null}

      <Card as="section" aria-labelledby="price-columns">
        <h2 id="price-columns" className="text-sm font-semibold">Columns</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="border-y border-border bg-secondary/50 text-left text-xs text-muted"><th scope="col" className="px-3 py-2 font-medium">Read as</th><th scope="col" className="px-3 py-2 font-medium">Source column</th></tr></thead>
            <tbody className="divide-y divide-border">
              {PRICE_CONCEPTS.map((concept) => (
                <tr key={concept}>
                  <th scope="row" className="px-3 py-2 text-left align-top font-medium">{PRICE_CONCEPT_LABELS[concept]}</th>
                  <td className="px-3 py-2 align-top">
                    <SelectField aria-label={`Source column for ${PRICE_CONCEPT_LABELS[concept]}`} name={`concept_${concept}`} size="small" defaultValue={plan.mapping[concept] ?? ''} options={[{ value: '', label: 'Not read' }, ...readable.map((column) => ({ value: column.name, label: column.name, description: column.examples[0] }))]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div data-slot="field-group" className="mt-3 grid gap-3 md:grid-cols-2">
          <FormField id="price-default-unit" label="Unit when a row has none" hint={`Prices are read in ${currency}.`}>{(field) => <TextInput {...field} name="defaultUnit" maxLength={40} defaultValue={plan.defaultUnit ?? ''} />}</FormField>
        </div>
        <Button type="submit" tone="secondary" size="small" className="mt-3 w-fit" formAction={libraryNewImportHref(organizationId)} formMethod="get" formNoValidate>Update preview</Button>
      </Card>

      <Card as="section" aria-labelledby="price-preview">
        <h2 id="price-preview" className="text-sm font-semibold">Preview</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Readiness">
          {[['Items to import', summary.ready], ['Rows left out', summary.invalid]].map(([label, value]) =>
            <div key={label} className="rounded-md bg-secondary px-3 py-2"><dt className="text-xs text-muted">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        {issues.length ? <ul className="mt-3 list-disc pl-5 text-sm" aria-label="Why rows are left out">{issues.map(([issue, rows]) => <li key={issue}>{count(rows, 'row')}: {issue}</li>)}</ul> : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="border-y border-border bg-secondary/50 text-left text-xs text-muted"><th scope="col" className="px-3 py-2 font-medium">Item</th><th scope="col" className="px-3 py-2 font-medium">Unit</th><th scope="col" className="px-3 py-2 text-right font-medium">Price</th><th scope="col" className="px-3 py-2 font-medium">Problem</th></tr></thead>
            <tbody className="divide-y divide-border">
              {preview.map((row) => (
                <tr key={row.key}>
                  <td className="px-3 py-2 align-top break-words">{row.normalized.name}</td>
                  <td className="px-3 py-2 align-top">{row.normalized.unit}</td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">{row.normalized.unit_amount_minor === null ? '' : formatMoney(row.normalized.unit_amount_minor, currency)}</td>
                  <td className="px-3 py-2 align-top text-muted">{row.validation_errors.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ButtonLink tone="secondary" href={libraryNewImportHref(organizationId, undefined, 'price_book')}>Choose a different source</ButtonLink>
        <Button type="submit" tone="primary">Review changes</Button>
      </div>
    </form>
  );
}
