'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Home, PanelLeft, Users } from 'lucide-react';
import { VISUAL_PRESETS, type BackgroundTreatment, type PersonalAppearancePreferences, type VisualPreset } from '@gold/ui/design-system';
import { ApplicationCanvasBackground } from '@/components/display/background-treatment';
import { VisualScope } from '@gold/ui/components/visual-scope';
import { Popover, PopoverTrigger, PopoverContent } from '@gold/ui/components/popover';
import { Button } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormField, FormActions, FormError } from '@/components/controls/form';
import { SelectableCard } from '@/components/controls/selectable-card';
import { Card } from '@/components/surfaces/card';
import { Toolbar } from '@/components/display/data';
import { OperationalPanel, StatePill } from '@/components/operational/primitives';
import { NavigationList } from '@/components/navigation/navigation-list';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@gold/ui/components/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gold/ui/components/table';
import { cx, FOCUS_RING_WITHIN } from '@/components/class-names';
import { updateAppearanceAction } from '@/app/settings/account/actions';
import { SelectField } from '@/components/controls/select-field';
import { APPLICATION_PREVIEW_FRAME, HEADER_HEIGHT_STYLE, SIDEBAR_HEADER_HEIGHT } from '@/components/layout/workspace-geometry';

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
          <FormField id="appearance-shape" label="Shape">{props => <SelectField {...props} value={draft.shape ?? ''} onValueChange={(next) => change('shape', (next || undefined) as PersonalAppearancePreferences['shape'])} options={[{ value: '', label: 'Same as style' }, { value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'soft', label: 'Soft' }]} />}</FormField>
          <FormField id="appearance-motion" label="Motion">{props => <SelectField {...props} value={draft.motion ?? 'system'} onValueChange={(next) => change('motion', next as PersonalAppearancePreferences['motion'])} options={[{ value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduced' }]} />}</FormField>
          <FormField id="appearance-background" label="Background">{props => <SelectField {...props} value={draft.background ?? 'none'} onValueChange={(next) => change('background', next === 'none' ? undefined : next as BackgroundTreatment)} options={[{ value: 'none', label: 'None' }, { value: 'gradient', label: 'Ambient gradient' }, { value: 'grid', label: 'Fine grid' }, { value: 'ambient3d', label: 'Ambient 3D' }]} />}</FormField>
        </div>
      </div>
    </fieldset>
    <section aria-label="Appearance preview" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Preview</h2><div className="w-40"><FormField id="appearance-preview-scheme" label="Preview theme">{props => <SelectField {...props} value={previewScheme} onValueChange={(next) => setPreviewScheme(next as 'light' | 'dark')} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />}</FormField></div></div>
      <VisualScope id="appearance-preview" selection={{ ...draft, appearance: previewScheme }} data-brand="" data-testid="appearance-preview" className="rounded-xl border border-border">
        <ApplicationPreview />
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

/** A bounded application composition, not another shell or preference owner. Portal content
 * stays outside the clipped frame but inside the draft VisualScope. */
function ApplicationPreview() {
  const [filter, setFilter] = useState('All');
  const [lifecycle, setLifecycle] = useState('customer');
  return <div className={APPLICATION_PREVIEW_FRAME} style={HEADER_HEIGHT_STYLE}>
    <aside aria-label="Preview sidebar" className="w-12 shrink-0 border-r border-border bg-sidebar p-1 sm:w-36 sm:p-2">
      <div className="flex h-10 items-center justify-center text-sm font-semibold sm:justify-start sm:px-3"><span className="sm:hidden">G</span><span className="hidden sm:inline">GildOps</span></div>
      <div className="hidden sm:block"><NavigationList label="Preview navigation" density="compact" items={[
        { key: 'home', title: 'Home', icon: <Home />, href: '#appearance-preview' },
        { key: 'crm', title: 'CRM', icon: <Users />, current: true, href: '#appearance-preview' },
      ]} /></div>
      <nav aria-label="Preview compact navigation" className="space-y-1 sm:hidden">
        <Button tone="ghost" aria-label="Preview Home" className="w-full px-0"><Home aria-hidden /></Button>
        <Button tone="ghost" aria-label="Preview CRM" aria-pressed className="w-full px-0"><Users aria-hidden /></Button>
      </nav>
    </aside>
    <div data-slot="preview-main" className="relative isolate flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className={cx('sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4', SIDEBAR_HEADER_HEIGHT)}>
        <PanelLeft aria-hidden className="size-4 shrink-0 text-muted" /><span className="text-sm font-medium">CRM</span><span aria-hidden className="text-muted">/</span><span className="truncate text-sm">Contacts</span>
      </header>
      <ApplicationCanvasBackground />
      <div className="relative space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Contacts</h3><Button type="button">Add contact</Button></div>
        <div className="grid grid-cols-2 gap-3">
          <Card><span className="text-xs text-muted">Contacts</span><span className="block text-xl font-semibold">24</span></Card>
          <Card variant="accent"><span className="text-xs text-muted">Follow-ups</span><span className="block text-xl font-semibold">3</span></Card>
        </div>
        <OperationalPanel title="Directory">
          <div className="space-y-3">
            <Toolbar><FormField id="appearance-example-input" label="Example input">{props => <TextInput {...props} placeholder="Find a contact" />}</FormField>
              <Popover><PopoverTrigger asChild><Button type="button" tone="secondary">Open preview filter</Button></PopoverTrigger><PopoverContent><FormField id="appearance-filter-status" label="Lifecycle">{props => <SelectField {...props} value={lifecycle} onValueChange={setLifecycle} options={[{ value: 'customer', label: 'Customer' }, { value: 'prospect', label: 'Prospect' }]} />}</FormField></PopoverContent></Popover>
            </Toolbar>
            <div role="group" aria-label="Preview collection filter" className="grid grid-cols-2 gap-2">
              {['All', 'Customers'].map(value => <SelectableCard key={value} selected={filter === value} onClick={() => setFilter(value)} className="min-h-11 flex-row items-center justify-between p-2">{value}{filter === value && <Check aria-hidden className="size-4" />}</SelectableCard>)}
            </div>
            <Table aria-label="Collection preview"><TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Follow-up</TableHead></TableRow></TableHeader><TableBody>
              <TableRow data-state="selected"><TableCell>Alex Morgan</TableCell><TableCell><StatePill tone="success">Completed</StatePill></TableCell></TableRow>
              {filter === 'All' && <TableRow><TableCell>Northstar Ltd</TableCell><TableCell><StatePill tone="danger">Overdue</StatePill></TableCell></TableRow>}
              <TableRow><TableCell>Jordan Lee</TableCell><TableCell><StatePill>Scheduled</StatePill></TableCell></TableRow>
            </TableBody></Table>
            <FormActions>
              <Dialog><DialogTrigger asChild><Button type="button" tone="secondary">Open preview dialog</Button></DialogTrigger><DialogContent className="flex flex-col gap-0 p-0"><StepHeader title="Preview dialog" steps={['Essentials', 'Additional information']} current={0} /><DialogBody><FormField id="appearance-dialog-input" label="Name">{props => <TextInput {...props} />}</FormField></DialogBody><DialogFooterBar><DialogClose asChild><Button type="button" tone="secondary">Close</Button></DialogClose></DialogFooterBar></DialogContent></Dialog>
              <Button type="button" tone="secondary" disabled>Export</Button>
            </FormActions>
          </div>
        </OperationalPanel>
      </div>
    </div>
  </div>;
}
