'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { simulatePackageAction, saveDraftScenarioAction, type DraftScenarioState } from '@/app/platform/package-economics/actions';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { Section, SectionHeading } from '@/components/surfaces/section';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { DataTable } from '@/components/display/table';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import type { DraftScenarioSummary, PackageEconomicsResult, SimulationProfile, SimulationSource } from '@/lib/domain/commercial/package-economics';

type Option = { id: string; label: string };
type Props = {
  platformOrganizationId: string;
  plans: Option[];
  addons: Option[];
  organizations: Option[];
  drafts: DraftScenarioSummary[];
  meters: Array<{ id: string; description: string; unit: string }>;
  initial: { result: PackageEconomicsResult; comparisons: PackageEconomicsResult[]; maxAllowance: PackageEconomicsResult };
};

const profileLabels: Record<SimulationProfile, string> = { low: 'Low', expected: 'Expected', heavy: 'Heavy', max_allowance: 'Max allowance' };
const DRAFT_SCENARIO_INITIAL: DraftScenarioState = { error: null, saved: false };
const sourceLabels: Record<SimulationSource['type'], string> = { plan_default: 'Plan default', draft_scenario: 'Draft scenario', organization_agreement: 'Organization agreement' };
const pct = (value: number | null) => value === null ? 'Incomplete' : `${(value * 100).toFixed(1)}%`;

function sourceOptions(type: SimulationSource['type'], props: Props): Option[] {
  if (type === 'plan_default') return props.plans;
  if (type === 'draft_scenario') return props.drafts.map((draft) => ({ id: draft.id, label: draft.name }));
  return props.organizations;
}

export function DraftScenarioDrawer({ platformOrganizationId, plans, addons, meters }: Pick<Props, 'platformOrganizationId' | 'plans' | 'addons' | 'meters'>) {
  const [state, action, pending] = useActionState(saveDraftScenarioAction, DRAFT_SCENARIO_INITIAL);
  const router = useRouter();
  useEffect(() => { if (state.saved) router.refresh(); }, [router, state.saved]);
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button>New draft scenario</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>New reference-customer scenario</PageDrawerTitle></PageDrawerHeader>
        <form action={action} className="flex flex-col gap-4 px-4 pb-8">
          <input type="hidden" name="platformOrganizationId" value={platformOrganizationId} />
          <div className="grid gap-1"><FieldLabel htmlFor="scenario-name">Name</FieldLabel><TextInput id="scenario-name" name="name" placeholder="NextFund candidate" required /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="scenario-notes">Notes</FieldLabel><TextArea id="scenario-notes" name="notes" rows={2} /></div>
          <div className="grid gap-1"><FieldLabel htmlFor="scenario-plan">Candidate Plan</FieldLabel><SelectInput id="scenario-plan" name="planId" required>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.label}</option>)}</SelectInput></div>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div className="grid gap-1"><FieldLabel htmlFor="scenario-prices">Candidate monthly prices</FieldLabel><TextInput id="scenario-prices" name="candidatePrices" placeholder="499, 699, 899, 999" required /></div>
            <div className="grid gap-1"><FieldLabel htmlFor="scenario-currency">Currency</FieldLabel><TextInput id="scenario-currency" name="currency" defaultValue="CAD" minLength={3} maxLength={3} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1"><FieldLabel htmlFor="scenario-seats">Expected seats</FieldLabel><TextInput id="scenario-seats" name="expectedSeats" type="number" min="0" /></div>
            <div className="grid gap-1"><FieldLabel htmlFor="scenario-resources">Expected resources</FieldLabel><TextInput id="scenario-resources" name="expectedResourceCount" type="number" min="0" /></div>
          </div>
          <Section>
            <SectionHeading>Expected usage</SectionHeading>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {meters.map((meter) => <div key={meter.id} className="grid gap-1"><FieldLabel htmlFor={`scenario-${meter.id}`}>{meter.description}</FieldLabel><TextInput id={`scenario-${meter.id}`} name={`usage:${meter.id}`} type="number" min="0" placeholder={meter.unit} /></div>)}
            </div>
          </Section>
          {addons.length ? <fieldset className="grid gap-2"><legend className="text-sm font-medium">Selected add-ons</legend>{addons.map((addon) => <label key={addon.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="addonPlanId" value={addon.id} />{addon.label}</label>)}</fieldset> : null}
          <Section>
            <SectionHeading>Manual direct-cost assumption</SectionHeading>
            <div className="mt-3 grid grid-cols-[1fr_8rem] gap-3"><TextInput name="directCostLabel" aria-label="Direct cost label" placeholder="Support allocation" /><TextInput name="directCostAmount" aria-label="Direct cost amount" type="number" min="0" step="0.01" placeholder="0.00" /></div>
          </Section>
          <p className="text-sm text-muted">Planning data only. Saving does not create a tenant, agreement, usage, resource, subscription, or invoice.</p>
          <ErrorText role="alert">{state.error}</ErrorText>
          {state.saved ? <p className="text-sm">Scenario saved.</p> : null}
          <Button type="submit" disabled={pending} className="w-fit">{pending ? 'Saving…' : 'Save scenario'}</Button>
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}

export function PackageSimulator(props: Props) {
  const [sourceType, setSourceType] = useState<SimulationSource['type']>(props.initial.result.sourceType);
  const [sourceId, setSourceId] = useState(props.initial.result.sourceId);
  const [profile, setProfile] = useState<SimulationProfile>(props.initial.result.profile);
  const [simulation, setSimulation] = useState(props.initial);
  const [customPrice, setCustomPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = sourceOptions(sourceType, props);

  const run = (next: { sourceType?: SimulationSource['type']; sourceId?: string; profile?: SimulationProfile; candidateAmountMinor?: number }) => {
    const nextType = next.sourceType ?? sourceType;
    const nextId = next.sourceId ?? sourceId;
    const nextProfile = next.profile ?? profile;
    if (!nextId) return;
    startTransition(async () => {
      const response = await simulatePackageAction({ platformOrganizationId: props.platformOrganizationId, sourceType: nextType, sourceId: nextId, profile: nextProfile, candidateAmountMinor: next.candidateAmountMinor });
      if (response.error || !response.data) setError(response.error ?? 'Simulation failed.');
      else { setSimulation(response.data); setError(null); }
    });
  };
  const result = simulation.result;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1"><FieldLabel htmlFor="simulation-source-type">Source</FieldLabel><SelectInput id="simulation-source-type" value={sourceType} onChange={(event) => { const type = event.target.value as SimulationSource['type']; const id = sourceOptions(type, props)[0]?.id ?? ''; setSourceType(type); setSourceId(id); run({ sourceType: type, sourceId: id }); }}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput></div>
        <div className="grid min-w-56 gap-1"><FieldLabel htmlFor="simulation-source">Selection</FieldLabel><SelectInput id="simulation-source" value={sourceId} onChange={(event) => { setSourceId(event.target.value); run({ sourceId: event.target.value }); }}>{options.length ? options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="">None available</option>}</SelectInput></div>
        <DraftScenarioDrawer platformOrganizationId={props.platformOrganizationId} plans={props.plans} addons={props.addons} meters={props.meters} />
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Usage scenario">{(Object.keys(profileLabels) as SimulationProfile[]).map((value) => <Button key={value} type="button" tone={profile === value ? 'primary' : 'secondary'} size="small" disabled={pending} onClick={() => { setProfile(value); run({ profile: value }); }}>{profileLabels[value]}</Button>)}</div>
      <ErrorText role="alert">{error}</ErrorText>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section>
          <SectionHeading>{result.sourceLabel}</SectionHeading>
          {result.sourceType === 'draft_scenario' ? <p className="mt-2 text-sm font-medium">Draft scenario · planning only · not an organization agreement</p> : null}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-muted">Plan</dt><dd className="font-medium">{result.planLabel}</dd></div>
            <div><dt className="text-muted">Price source</dt><dd>{result.priceSource}</dd></div>
            <div><dt className="text-muted">Monthly price</dt><dd className="font-medium tabular-nums">{formatMoney(result.candidateAmountMinor, result.currency)}</dd></div>
            <div><dt className="text-muted">Add-ons</dt><dd>{result.selectedAddons.join(', ') || 'None'}</dd></div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">{simulation.comparisons.map((item) => <Button key={item.candidateAmountMinor} type="button" tone="secondary" size="small" disabled={pending} onClick={() => run({ candidateAmountMinor: item.candidateAmountMinor })}>{formatMoney(item.candidateAmountMinor, item.currency)}</Button>)}</div>
          <div className="mt-3 flex max-w-xs gap-2"><TextInput aria-label="Custom monthly price" value={customPrice} onChange={(event) => setCustomPrice(event.target.value)} type="number" min="0" step="0.01" placeholder="Custom" /><Button type="button" tone="secondary" disabled={!customPrice || pending} onClick={() => run({ candidateAmountMinor: Math.round(Number(customPrice) * 100) })}>Apply</Button></div>
        </Section>
        <Section>
          <SectionHeading>Economics</SectionHeading>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-muted">Revenue</dt><dd className="font-medium tabular-nums">{formatMoney(result.totalRevenueMinor, result.currency)}</dd></div>
            <div><dt className="text-muted">Known COGS</dt><dd className="font-medium tabular-nums">{formatMoney(result.totalKnownCogsMinor, result.currency)}</dd></div>
            <div><dt className="text-muted">Gross contribution</dt><dd className="font-medium tabular-nums">{result.grossContributionMinor === null ? 'Incomplete' : formatMoney(result.grossContributionMinor, result.currency)}</dd></div>
            <div><dt className="text-muted">Gross margin</dt><dd className="font-medium tabular-nums">{pct(result.grossMargin)}</dd></div>
            <div><dt className="text-muted">Cost coverage</dt><dd className="tabular-nums">{pct(result.costCoverage)}</dd></div>
            <div><dt className="text-muted">Status</dt><dd>{result.status.replaceAll('_', ' ')}</dd></div>
            <div><dt className="text-muted">Target margin</dt><dd>{pct(result.targetMargin)}</dd></div>
            <div><dt className="text-muted">Scenario estimate</dt><dd>{result.requiredRevenueForTargetMinor === null ? 'Incomplete' : `${formatMoney(result.requiredRevenueForTargetMinor, result.currency)} required`}</dd></div>
            <div><dt className="text-muted">Max-allowance COGS</dt><dd className="tabular-nums">{formatMoney(simulation.maxAllowance.totalKnownCogsMinor, result.currency)}</dd></div>
            <div><dt className="text-muted">Max-allowance margin</dt><dd className="tabular-nums">{pct(simulation.maxAllowance.grossMargin)}</dd></div>
          </dl>
          {result.unknownCosts.length ? <div className="mt-5 border-l-2 border-danger/50 pl-3 text-sm"><p className="font-medium">Margin incomplete</p><ul className="mt-1 text-muted">{result.unknownCosts.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
        </Section>
      </div>

      <Section>
        <SectionHeading>Meter economics</SectionHeading>
        <div className="mt-3"><DataTable rows={result.meters} rowKey={(row) => row.allowanceKey} empty="No metered allowances in this package." columns={[
          { key: 'meter', header: 'Allowance', emphasis: 'primary', cell: (row) => <div><span className="font-medium">{row.label}</span><span className="block text-xs text-muted">{row.provenance}</span></div> },
          { key: 'included', header: 'Included', numeric: true, cell: (row) => `${row.allowance.toLocaleString()} ${row.unit}` },
          { key: 'expected', header: 'Scenario usage', numeric: true, cell: (row) => `${row.expectedQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.unit}` },
          { key: 'cost', header: 'Known COGS', numeric: true, cell: (row) => row.unknownComponents.length ? `${formatMoney(row.knownCogsMinor, result.currency)} + unknown` : formatMoney(row.knownCogsMinor, result.currency) },
          { key: 'overage', header: 'Overage', numeric: true, cell: (row) => row.overageQuantity ? `${row.overageQuantity.toLocaleString()} ${row.unit}` : '—' },
        ]} /></div>
      </Section>

      <Section>
        <SectionHeading>Candidate comparison</SectionHeading>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{simulation.comparisons.map((item) => <dl key={item.candidateAmountMinor} className="border-t border-border pt-3 text-sm"><dt className="font-medium">{formatMoney(item.candidateAmountMinor, item.currency)}</dt><dd className="mt-2 flex justify-between"><span className="text-muted">Expected COGS</span><span>{formatMoney(item.totalKnownCogsMinor, item.currency)}</span></dd><dd className="flex justify-between"><span className="text-muted">Margin</span><span>{pct(item.grossMargin)}</span></dd><dd className="flex justify-between"><span className="text-muted">Status</span><span>{item.status.replaceAll('_', ' ')}</span></dd></dl>)}</div>
      </Section>
    </div>
  );
}
