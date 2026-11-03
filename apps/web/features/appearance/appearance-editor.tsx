'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, User, X } from 'lucide-react';
import { VISUAL_PRESETS, type BackgroundTreatment, type PersonalAppearancePreferences, type VisualPreset } from '@gold/ui/design-system';
import { DecorativeBackground } from '@/components/display/background-treatment';
import { VisualScope } from '@gold/ui/components/visual-scope';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@gold/ui/components/tabs';
import { Popover, PopoverTrigger, PopoverContent } from '@gold/ui/components/popover';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormField, FormActions, FormError } from '@/components/controls/form';
import { SelectableCard } from '@/components/controls/selectable-card';
import { Card } from '@/components/surfaces/card';
import { Toolbar } from '@/components/display/data';
import { EntityIdentity, EntityRow } from '@/components/display/entity-row';
import { StatusSummary } from '@/components/display/status-summary';
import { ViewNav } from '@/components/navigation/view-nav';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { Dialog, DialogContent, DialogTrigger } from '@gold/ui/components/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gold/ui/components/table';
import { cx, FOCUS_RING_WITHIN } from '@/components/class-names';
import { updateAppearanceAction } from '@/app/settings/account/actions';
import { SelectField } from '@/components/controls/select-field';

const PRESET_CHOICES: { value?: VisualPreset; label: string }[] = [
  { label: 'Platform default' },
  ...(Object.keys(VISUAL_PRESETS) as VisualPreset[]).map(value => ({ value, label: VISUAL_PRESETS[value].label })),
];

function equal(a: PersonalAppearancePreferences, b: PersonalAppearancePreferences) {
  return (['appearance', 'preset', 'density', 'shape', 'motion', 'background'] as const).every(key => a[key] === b[key]);
}

export function AppearanceEditor({ saved }: { saved: PersonalAppearancePreferences }) {
  const [baseline, setBaseline] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [previewScheme, setPreviewScheme] = useState<'light' | 'dark'>('light');
  const [previewSurface, setPreviewSurface] = useState('Services');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const presetName = useId();
  const router = useRouter();
  const dirty = !equal(draft, baseline);
  function change<K extends keyof PersonalAppearancePreferences>(key: K, value: PersonalAppearancePreferences[K]) {
    setDraft(current => ({ ...current, [key]: value })); setMessage(''); setError(undefined);
    if (key === 'appearance' && (value === 'light' || value === 'dark')) setPreviewScheme(value);
  }
  function persist(reset = false) {
    setError(undefined); setMessage('');
    startTransition(async () => {
      try {
        const result = await updateAppearanceAction(draft, reset);
        if (result.error || !result.selection) { setError(result.error ?? 'Unable to save your appearance. Try again.'); return; }
        setBaseline(result.selection); setDraft(result.selection);
        setMessage(reset ? 'Defaults restored.' : 'Appearance saved.');
        router.refresh();
      } catch { setError('Unable to save your appearance. Your changes remain unsaved.'); }
    });
  }
  return <div className="space-y-8 pb-6">
    <p className="max-w-prose text-sm text-muted">Your appearance follows your account across businesses. It changes your own interface; organization branding and published websites keep their own design.</p>
    <fieldset disabled={pending} className="min-w-0">
      <legend className="sr-only">Personal appearance settings</legend>
      {/* Only the controls are a size container: containment on a preview ancestor would become its popover's containing block. */}
      <div className="@container space-y-6">
        <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">Visual style</legend>
          <div className="grid gap-2 @xs:grid-cols-2 @2xl:grid-cols-4">
            {PRESET_CHOICES.map(({ value, label }) => {
              const selected = draft.preset === value;
              return <label key={label} data-slot="preset-choice" className={cx(
                'flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-medium',
                FOCUS_RING_WITHIN,
                'has-disabled:cursor-not-allowed has-disabled:opacity-60',
                selected ? 'border-foreground bg-selected' : 'border-border hover:bg-hover',
              )}>
                <input type="radio" name={presetName} value={value ?? ''} checked={selected} onChange={() => change('preset', value)} className="sr-only" />
                <span className="min-w-0">{label}</span>
                {selected && <Check aria-hidden className="size-4 shrink-0" />}
              </label>;
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-5">
          <FormField id="appearance-theme" label="Theme">{props => <SelectField {...props} value={draft.appearance ?? 'system'} onValueChange={(next) => change('appearance', next as PersonalAppearancePreferences['appearance'])} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />}</FormField>
          <FormField id="appearance-density" label="Density">{props => <SelectField {...props} value={draft.density ?? ''} onValueChange={(next) => change('density', (next || undefined) as PersonalAppearancePreferences['density'])} options={[{ value: '', label: 'Platform default' }, { value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} />}</FormField>
          <FormField id="appearance-shape" label="Shape">{props => <SelectField {...props} value={draft.shape ?? ''} onValueChange={(next) => change('shape', (next || undefined) as PersonalAppearancePreferences['shape'])} options={[{ value: '', label: 'Inherit from preset' }, { value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'soft', label: 'Soft' }]} />}</FormField>
          <FormField id="appearance-motion" label="Motion">{props => <SelectField {...props} value={draft.motion ?? 'system'} onValueChange={(next) => change('motion', next as PersonalAppearancePreferences['motion'])} options={[{ value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduced' }]} />}</FormField>
          <FormField id="appearance-background" label="Background">{props => <SelectField {...props} value={draft.background ?? 'none'} onValueChange={(next) => change('background', next === 'none' ? undefined : next as BackgroundTreatment)} options={[{ value: 'none', label: 'None' }, { value: 'gradient', label: 'Ambient gradient' }, { value: 'grid', label: 'Fine grid' }, { value: 'ambient3d', label: 'Ambient 3D' }]} />}</FormField>
        </div>
      </div>
    </fieldset>
    <section aria-label="Appearance preview" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Preview</h2><div className="w-40"><FormField id="appearance-preview-scheme" label="Preview theme">{props => <SelectField {...props} value={previewScheme} onValueChange={(next) => setPreviewScheme(next as 'light' | 'dark')} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />}</FormField></div></div>
      <VisualScope selection={{ ...draft, appearance: previewScheme }} data-testid="appearance-preview" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4 rounded-xl border border-border p-4 sm:p-6">
        <div data-testid="appearance-preview-intro" className="relative isolate overflow-hidden rounded-(--visual-radius,0.625rem) border border-border px-4 py-5 col-span-full">
          <DecorativeBackground clear="start" />
          <h3 className="text-lg font-semibold">Good morning</h3>
          <p className="text-sm text-muted">Dashboard introduction. {draft.background && draft.background !== 'none' ? 'Decorates introductions only.' : 'No background.'}</p>
        </div>
        <Card className="space-y-4">
          <h3 className="font-semibold">Your workspace</h3>
          <FormField id="appearance-example-input" label="Example input">{props => <TextInput {...props} placeholder="Enter a preview value" />}</FormField>
          <Toolbar><Tabs defaultValue="overview"><TabsList variant="segmented" aria-label="Preview views"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList><TabsContent value="overview">Overview preview</TabsContent><TabsContent value="activity">Activity preview</TabsContent></Tabs>
            <Popover><PopoverTrigger asChild><Button tone="secondary">Open preview filter</Button></PopoverTrigger><PopoverContent><p>Filters inherit your appearance.</p></PopoverContent></Popover>
          </Toolbar>
          <FormActions><Button type="button">Primary action</Button><Button type="button" tone="secondary" aria-pressed>Selected control</Button></FormActions>
        </Card>
        <div className="grid content-start gap-4">
          <div role="group" aria-label="Preview surface" className="grid grid-cols-2 gap-2">
            {['Services', 'Products'].map(surface => <SelectableCard key={surface} selected={previewSurface === surface} onClick={() => setPreviewSurface(surface)} className="min-h-0">
              {surface}<span className="text-xs font-normal text-muted">{previewSurface === surface ? 'Selected' : 'Choose'}</span>
            </SelectableCard>)}
          </div>
          <Card variant="accent" className="space-y-1"><h3 className="font-semibold">Accent surface</h3><p className="text-sm text-muted">Highlighted content keeps neutral text.</p></Card>
        </div>
        {/* Representative operational surfaces, drawn with the real shared components so every preset,
            density and shape is shown on rows, tables, selected views, filters and dialogs. */}
        <Card className="space-y-3 [grid-column:1/-1]" aria-label="Collection preview">
          <h3 className="font-semibold">Collection</h3>
          <ViewNav label="Preview collection views" className="mb-0" items={[{ key: 'all', label: 'All', href: '#appearance-preview', current: true }, { key: 'people', label: 'People', href: '#appearance-preview' }, { key: 'companies', label: 'Companies', href: '#appearance-preview' }]} />
          <div role="group" aria-label="Preview active filters" className="flex flex-wrap gap-2"><span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs">Lifecycle: Customer <X aria-hidden className="size-3" /></span></div>
          <ul className="divide-y divide-border overflow-hidden rounded-[var(--visual-radius,0.625rem)] border border-border">
            <EntityRow identity={<EntityIdentity icon={User} kind="Person" name="Example person" secondary="Person · Example company" />} status={<StatusSummary label="Example person lifecycle" items={[{ label: 'Lifecycle', value: 'Customer' }]} />} activity="Call completed (3 min)" timestamp="Today" />
            <EntityRow identity={<EntityIdentity icon={Building2} kind="Company" name="Example company" secondary="Company" />} status={<StatusSummary label="Example company lifecycle" items={[{ label: 'Lifecycle', value: 'Prospect' }]} />} activity="Opportunity opened" timestamp="Yesterday" />
          </ul>
          <Table><TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Lifecycle</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Example person</TableCell><TableCell>Customer</TableCell></TableRow><TableRow><TableCell>Example company</TableCell><TableCell>Prospect</TableCell></TableRow></TableBody></Table>
          <Dialog><DialogTrigger asChild><Button type="button" tone="secondary">Open preview dialog</Button></DialogTrigger><DialogContent className="flex flex-col gap-0 p-0"><StepHeader title="Preview dialog" steps={['Essentials', 'Additional information']} current={0} /><DialogBody><FormField id="appearance-dialog-input" label="Name">{props => <TextInput {...props} />}</FormField></DialogBody><DialogFooterBar><Button type="button">Save</Button><Button type="button" tone="secondary">Cancel</Button></DialogFooterBar></DialogContent></Dialog>
        </Card>
      </VisualScope>
    </section>
    <div className="space-y-3 border-t border-border pt-4">
      <p role="status" aria-live="polite" className="text-sm text-muted">{pending ? 'Saving appearance…' : error ? 'Changes have not been saved.' : dirty ? 'Unsaved changes' : message || 'Using saved appearance'}</p>
      {error && <FormError>{error}</FormError>}
      <FormActions><Button type="button" disabled={!dirty} loading={pending} onClick={() => persist()}>Save appearance</Button>
        <Button type="button" tone="secondary" disabled={!dirty || pending} onClick={() => { setDraft(baseline); setError(undefined); setMessage('Changes discarded.'); }}>Discard changes</Button>
        <Button type="button" tone="text" disabled={pending} onClick={() => persist(true)}>Reset to defaults</Button></FormActions>
    </div>
  </div>;
}
