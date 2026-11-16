import { Card, Disclosure } from '@/components/surfaces/card';
import { CheckboxField } from '@/components/controls/checkbox-field';
import { FormField } from '@/components/controls/form';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectField } from '@/components/controls/select-field';
import { CONTACT_LIFECYCLES, classificationLabel } from '@/lib/domain/customers/classification';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { CONCEPTS, CONCEPT_LABELS, type SourceInspection } from '@/lib/domain/integrations/translation';
import { describeQuality } from '@/lib/domain/integrations/translation/inspect';
import { libraryNewImportHref } from '@/lib/route/library';
import { createTranslationAndStageAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';

/**
 * Step 2 of a translated import: what was found in the source, which readings of it are proposed
 * (each with its evidence, approved or rejected by the person), what will need attention, and the
 * defaults for new contacts. Technical column assignment stays under Advanced. Submitting saves
 * the plan and stages the rows; nothing is written to Contacts here.
 */
export function InterpretationEditor({ organizationId, resourceId, inspection, definitions, error }: {
  organizationId: string;
  resourceId: string;
  inspection: SourceInspection;
  definitions: FieldDefinition[];
  error?: string;
}) {
  const { discovery, interpretations, plan, summary } = inspection;
  const readable = discovery.columns.filter((column) => !column.sensitive);
  const read = new Set(Object.values(plan.mapping));
  const unrecognized = readable.filter((column) => !read.has(column.name) && column.populated > 0 && column.origin === 'column' && !['record_status', 'quality_issues', 'business_ref', 'person_ref', 'affiliation_relationship', 'affiliation_verified', 'address_type', 'address_verified', 'phone_display', 'phone_owner', 'phone_ownership_verified'].includes(column.name));
  const quality = describeQuality(summary);
  const count = (value: number, singular: string, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
  return (
    <form action={createTranslationAndStageAction} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <p className="max-w-3xl text-sm text-muted">{count(discovery.rowCount, 'row')} read. Nothing is written yet.</p>
      {error ? <ErrorText role="alert">{error}</ErrorText> : null}

      <Card as="section" aria-labelledby="interpretation-found">
        <h2 id="interpretation-found" className="text-sm font-semibold">What was found</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Found in the source">
          {[
            ['Businesses', summary.businesses.total], ['People', summary.people.total], ['Links between them', summary.affiliations],
            ['Addresses', summary.addresses], ['Telephones', summary.phones],
            ['Columns', discovery.columns.length], ['Embedded in a text column', discovery.nestedColumns.length], ['Rows with nothing usable', summary.blockedRows],
          ].map(([label, value]) => <div key={label} className="rounded-md bg-secondary px-3 py-2"><dt className="text-xs text-muted">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        {discovery.workbenchPackage ? <Hint className="mt-3 block">Recognized as a GuildOps Import Workbench export; its source references are used as stable IDs and its review flags are kept.</Hint> : null}
      </Card>

      <Card as="section" aria-labelledby="interpretation-rules">
        <h2 id="interpretation-rules" className="text-sm font-semibold">Interpretations</h2>
        {interpretations.length === 0 ? <p className="mt-3 text-sm text-muted">Every column is read as it is; nothing in this source needs interpreting.</p> : null}
        <ul className="mt-3 divide-y divide-border">
          {interpretations.map((interpretation) => (
            <li key={interpretation.id} className="py-3">
              <CheckboxField id={`interpretation-${interpretation.id}`} name={`interpretation_${interpretation.id}`} value="approved" defaultChecked={plan.decisions[interpretation.id] === 'approved'} label={<span className="font-medium">{interpretation.title}</span>} />
              <p className="mt-1 pl-6 text-sm text-muted">{interpretation.effect}</p>
              <Disclosure className="mt-2 ml-6" summary={<span className="text-sm">{interpretation.evidenceType === 'direct' ? 'Pattern found' : 'Suggested reading'} in {count(interpretation.affectedRows, 'row')}</span>}>
                <p className="text-sm">{interpretation.explanation}</p>
                <p className="mt-2 text-xs text-muted">From {interpretation.sources.join(', ')}</p>
                {interpretation.examples.length ? <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  {interpretation.examples.flatMap((example, index) => Object.entries(example).map(([column, value]) => <div key={`${index}-${column}`} className="contents"><dt className="text-muted">{column}</dt><dd className="break-words">{value}</dd></div>))}
                </dl> : null}
              </Disclosure>
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="interpretation-quality">
        <h2 id="interpretation-quality" className="text-sm font-semibold">Needs attention</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Readiness">
          {[['Businesses ready', summary.businesses.ready], ['Businesses to confirm', summary.businesses.review], ['People ready', summary.people.ready], ['People to confirm', summary.people.review]].map(([label, value]) =>
            <div key={label} className="rounded-md bg-secondary px-3 py-2"><dt className="text-xs text-muted">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        {quality.length ? <ul className="mt-3 list-disc pl-5 text-sm" aria-label="Quality findings">{quality.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="mt-3 text-sm text-muted">No row needs attention.</p>}
        <Hint className="mt-3 block">Rows to confirm are held on the next step until you decide each one. A do-not-call value is kept as a restriction, never as permission to call.</Hint>
      </Card>

      <Card as="section" aria-labelledby="interpretation-defaults">
        <h2 id="interpretation-defaults" className="text-sm font-semibold">New contacts</h2>
        <div data-slot="field-group" className="mt-3 grid gap-3 md:grid-cols-2">
          <FormField id="interpretation-lifecycle" label="Lifecycle for new contacts" hint="Existing contacts keep theirs.">{field => <SelectField {...field} name="defaultLifecycle" defaultValue="" options={[{ value: '', label: 'Unclassified' }, ...CONTACT_LIFECYCLES.map((value) => ({ value, label: classificationLabel(value) }))]} />}</FormField>
          <FormField id="interpretation-suppression" label="Historical do-not-call values">{field => <SelectField {...field} name="suppression" defaultValue="reference" options={[{ value: 'reference', label: 'Keep on the business as Do not call' }, { value: 'omit', label: 'Do not write; still hold the row' }]} />}</FormField>
        </div>
      </Card>

      <Disclosure summary={<span className="text-sm font-medium">Advanced: source columns</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="border-y border-border bg-secondary/50 text-left text-xs text-muted"><th scope="col" className="px-3 py-2 font-medium">Read as</th><th scope="col" className="px-3 py-2 font-medium">Source column</th></tr></thead>
            <tbody className="divide-y divide-border">
              {CONCEPTS.map((concept) => (
                <tr key={concept}>
                  <th scope="row" className="px-3 py-2 text-left align-top font-medium">{CONCEPT_LABELS[concept]}</th>
                  <td className="px-3 py-2 align-top">
                    <SelectField aria-label={`Source column for ${CONCEPT_LABELS[concept]}`} name={`concept_${concept}`} size="small" defaultValue={plan.mapping[concept] ?? ''} options={[{ value: '', label: 'Not read' }, ...readable.map((column) => ({ value: column.name, label: column.origin === 'nested' ? `${column.name} (embedded)` : column.name, description: column.examples[0] }))]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unrecognized.length ? <>
          <h3 className="mt-4 text-sm font-medium">Other columns</h3>
          <Hint className="mt-1 block">A column kept becomes that field on each business. Columns not kept stay with the import&apos;s source data.</Hint>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead><tr className="border-y border-border bg-secondary/50 text-left text-xs text-muted"><th scope="col" className="px-3 py-2 font-medium">Source column</th><th scope="col" className="px-3 py-2 font-medium">Sample value</th><th scope="col" className="px-3 py-2 font-medium">Keep as</th></tr></thead>
              <tbody className="divide-y divide-border">
                {unrecognized.map((column) => (
                  <tr key={column.name}>
                    <th scope="row" className="px-3 py-2 text-left align-top font-medium">{column.name}<input type="hidden" name="extra_column" value={column.name} /></th>
                    <td className="max-w-48 truncate px-3 py-2 align-top text-muted">{column.examples[0] ?? ''}</td>
                    <td className="px-3 py-2 align-top">
                      <SelectField aria-label={`Keep ${column.name} as`} name={`extra_${column.name}`} size="small" defaultValue="" options={[{ value: '', label: 'Do not keep' }, ...definitions.map((definition) => ({ value: definition.key, label: definition.label }))]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </> : null}
      </Disclosure>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <ButtonLink tone="secondary" href={libraryNewImportHref(organizationId)}>Choose a different source</ButtonLink>
          <ButtonLink tone="text" href={`${libraryNewImportHref(organizationId, resourceId)}&mode=columns`}>Map columns one by one instead</ButtonLink>
        </div>
        <Button type="submit" tone="primary">Review changes</Button>
      </div>
    </form>
  );
}
