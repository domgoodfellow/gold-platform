'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/controls/button';
import { TextInput, SelectInput, FieldLabel, ErrorText } from '@/components/controls/inputs';
import { OperationalPanel } from '@/components/operational/primitives';
import { CurrencyField } from '@/features/locale/locale-fields';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import { calculatePricingScenario, emptyScenario, type PricingScenario } from '@/lib/domain/pricing/planning';

const COST_FIELDS = [
  ['laborRate', 'Labor cost per hour'], ['materials', 'Materials cost'],
  ['supplier', 'Supplier cost'], ['other', 'Other estimated cost'],
] as const;
type Draft = { id: number; scenario: PricingScenario; catalogId: string };

export function PricingPlanner({ currency, items }: { currency: string | null; items: PriceBookItem[] }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => [{ id: 1, scenario: emptyScenario(currency ?? ''), catalogId: '' }]);
  const update = (id: number, scenario: PricingScenario, catalogId: string) => setDrafts(current => current.map(d => d.id === id ? { ...d, scenario, catalogId } : d));
  return <OperationalPanel title="Economics & pricing planning" density="compact" action={
    <Button tone="secondary" disabled={drafts.length >= 3} onClick={() => setDrafts(current => [...current, { ...structuredClone(current[current.length - 1]), id: Math.max(...current.map(d => d.id)) + 1 }])}>Compare another scenario</Button>
  }>
    <p className="mb-2 text-sm text-muted">Estimated costs and suggested prices · unsaved. Changes stay on this page and are lost when you leave or reload.</p>
    <p className="mb-4 text-sm text-muted">Use recorded Work costs in the report above as historical context, then enter your own delivery assumptions below. Forecast profit is not realized profit. Catalog prices, quotes and invoices are unchanged.</p>
    {items.length === 0 ? <p className="mb-4 text-sm text-muted">No catalog items yet. You can still model estimated costs and compare scenarios.</p> : null}
    <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
      {drafts.map(draft => <ScenarioCard key={draft.id} draft={draft} items={items} onChange={(scenario, catalogId = draft.catalogId) => update(draft.id, scenario, catalogId)} onRemove={drafts.length > 1 ? () => setDrafts(current => current.filter(d => d.id !== draft.id)) : undefined} />)}
    </div>
    <p className="mt-3 text-xs text-muted">Target margin = profit ÷ selling price. Labor cost rounds half up once; suggested price rounds up to the smallest currency unit. All assumptions use the selected currency; changing it clears the amounts. A comparison is for one catalog unit, before tax.</p>
  </OperationalPanel>;
}

function ScenarioCard({ draft, items, onChange, onRemove }: { draft: Draft; items: PriceBookItem[]; onChange: (scenario: PricingScenario, catalogId?: string) => void; onRemove?: () => void }) {
  const id = useId();
  const { scenario: s, catalogId } = draft;
  const item = items.find(item => item.id === catalogId);
  const result = calculatePricingScenario(s, item);
  const set = <K extends keyof PricingScenario>(key: K, value: PricingScenario[K]) => onChange({ ...s, [key]: value });
  const money = (n: number | null) => n === null ? 'Unknown' : formatMoney(n, s.currency);
  const textField = (key: 'laborQuantity' | 'targetMargin', label: string) => <div className="space-y-1">
    <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
    <TextInput id={`${id}-${key}`} inputMode="decimal" value={s[key]} placeholder="Unknown" aria-invalid={Boolean(s[key] && result.errors[key])} aria-describedby={s[key] && result.errors[key] ? `${id}-${key}-error` : undefined} onChange={e => set(key, e.target.value)} />
    <ErrorText id={`${id}-${key}-error`}>{s[key] ? result.errors[key] : null}</ErrorText>
  </div>;
  return <fieldset aria-label={`Scenario ${draft.id}`} className="min-w-0 space-y-3 rounded-lg border border-border p-3">
    <legend className="px-1 text-sm font-semibold">Scenario {draft.id}</legend>
    {onRemove ? <Button tone="ghost" onClick={onRemove} aria-label={`Remove scenario ${draft.id}`}>Remove</Button> : null}
    <CurrencyField id={`${id}-currency`} value={s.currency} hint="Currency of these assumptions. Changing it clears amounts." onChange={currency => onChange({ ...emptyScenario(currency), laborQuantity: s.laborQuantity, targetMargin: s.targetMargin }, catalogId)} />
    {s.currency ? <ErrorText>{result.errors.currency}</ErrorText> : null}
    <div className="grid min-w-0 grid-cols-2 items-end gap-3">
    {textField('laborQuantity', 'Labor quantity (hours)')}
    {COST_FIELDS.map(([key, label]) => <div key={key} className="min-w-0 space-y-1">
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <TextInput id={`${id}-${key}`} inputMode="decimal" value={s[key].amount} placeholder="Unknown" aria-invalid={Boolean(s[key].amount && result.errors[key])} aria-describedby={s[key].amount && result.errors[key] ? `${id}-${key}-error` : undefined} onChange={e => set(key, { amount: e.target.value, currency: s.currency })} />
      <ErrorText id={`${id}-${key}-error`}>{s[key].amount ? result.errors[key] : null}</ErrorText>
    </div>)}
    {textField('targetMargin', 'Target gross margin (%)')}
    </div>
    <div className="space-y-1">
      <FieldLabel htmlFor={`${id}-note`}>Zero-cost assumptions</FieldLabel>
      <TextInput id={`${id}-note`} value={s.zeroCostNote} placeholder="Explain any costs entered as zero" maxLength={500} onChange={e => set('zeroCostNote', e.target.value)} aria-describedby={`${id}-note-error`} aria-invalid={Boolean(result.errors.zeroCostNote)} />
      <ErrorText id={`${id}-note-error`}>{result.errors.zeroCostNote}</ErrorText>
    </div>
    <div className="space-y-1">
      <FieldLabel htmlFor={`${id}-catalog`}>Compare one catalog unit</FieldLabel>
      <SelectInput id={`${id}-catalog`} value={catalogId} onChange={e => onChange(s, e.target.value)}>
        <option value="">No comparison</option>
        {items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit} · {item.currency}</option>)}
      </SelectInput>
      {item ? <p className="text-sm text-muted">Current catalog: {formatMoney(item.unitAmountMinor, item.currency)} / {item.unit}. Model delivery of one {item.unit} for a meaningful comparison.</p> : null}
    </div>
    <div className="border-t border-border pt-3" aria-live="polite" aria-atomic="true">
      <dl className="space-y-2 text-sm tabular-nums">
        <ResultRow label="Total estimated cost" value={money(result.estimatedCostMinor)} />
        <ResultRow label="Suggested selling price" value={<span data-testid="suggested-price" className="font-semibold">{money(result.suggestedPriceMinor)}</span>} />
        <ResultRow label="Estimated gross profit" value={money(result.estimatedProfitMinor)} />
        <ResultRow label="Estimated gross margin" value={result.estimatedMarginPercent === null ? result.suggestedPriceMinor === 0 ? 'Undefined' : 'Unknown' : `${result.estimatedMarginPercent.toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`} />
        {item ? <ResultRow label="Suggestion minus catalog" value={money(result.catalogDifferenceMinor)} /> : null}
      </dl>
      {result.comparisonIssue ? <p className="mt-2 text-sm text-warning">{result.comparisonIssue}</p> : null}
      {result.estimatedCostMinor === null ? <p className="mt-2 text-xs text-muted">Complete every cost assumption. Missing costs are unknown, never zero.</p> : null}
      {result.suggestedPriceMinor === 0 ? <p className="mt-2 text-xs text-muted">A zero selling price has no defined gross margin.</p> : null}
    </div>
  </fieldset>;
}

function ResultRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><dt className="text-muted">{label}</dt><dd className="break-all">{value}</dd></div>;
}
