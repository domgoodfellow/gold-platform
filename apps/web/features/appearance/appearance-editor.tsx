'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { VISUAL_PRESETS, type PersonalAppearancePreferences, type VisualPreset } from '@gold/ui/design-system';
import { VisualScope } from '@gold/ui/components/visual-scope';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@gold/ui/components/tabs';
import { Popover, PopoverTrigger, PopoverContent } from '@gold/ui/components/popover';
import { Button } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { FormField, FormActions, FormError } from '@/components/controls/form';
import { SelectableCard } from '@/components/controls/selectable-card';
import { Card } from '@/components/surfaces/card';
import { Toolbar } from '@/components/display/data';
import { updateAppearanceAction } from '@/app/settings/account/actions';

function equal(a: PersonalAppearancePreferences, b: PersonalAppearancePreferences) {
  return (['appearance', 'preset', 'density', 'shape', 'motion'] as const).every(key => a[key] === b[key]);
}

export function AppearanceEditor({ saved }: { saved: PersonalAppearancePreferences }) {
  const [baseline, setBaseline] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [previewScheme, setPreviewScheme] = useState<'light' | 'dark'>('light');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
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
    <fieldset disabled={pending} className="space-y-6">
      <legend className="sr-only">Personal appearance settings</legend>
      <FormField id="appearance-theme" label="Theme">{props => <SelectInput {...props} value={draft.appearance ?? 'system'} onChange={event => change('appearance', event.target.value as PersonalAppearancePreferences['appearance'])}>
        <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
      </SelectInput>}</FormField>
      <fieldset><legend className="mb-3 text-sm font-medium">Visual style</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([undefined, ...Object.keys(VISUAL_PRESETS)] as (VisualPreset | undefined)[]).map(preset => <div key={preset ?? 'default'} className="min-w-0">
            <SelectableCard selected={draft.preset === preset} aria-label={preset ? VISUAL_PRESETS[preset].label : 'Platform default'} onClick={() => change('preset', preset)}>
              <span className="flex w-full items-center justify-between gap-2"><span>{preset ? VISUAL_PRESETS[preset].label : 'Platform default'}</span>{draft.preset === preset && <span className="text-xs">✓ Selected</span>}</span>
            </SelectableCard>
            <VisualScope selection={{ preset, appearance: previewScheme }} className="mt-2 rounded-lg border border-border p-3" aria-hidden="true">
              <div inert><Card className="space-y-2"><span className="text-xs text-muted">Surface preview</span><Button size="small">Action</Button><TextInput value="Field" readOnly tabIndex={-1} /></Card></div>
            </VisualScope>
          </div>)}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="appearance-density" label="Density">{props => <SelectInput {...props} value={draft.density ?? ''} onChange={event => change('density', (event.target.value || undefined) as PersonalAppearancePreferences['density'])}><option value="">Platform default</option><option value="compact">Compact</option><option value="comfortable">Comfortable</option></SelectInput>}</FormField>
        <FormField id="appearance-shape" label="Shape">{props => <SelectInput {...props} value={draft.shape ?? ''} onChange={event => change('shape', (event.target.value || undefined) as PersonalAppearancePreferences['shape'])}><option value="">Inherit from preset</option><option value="square">Square</option><option value="rounded">Rounded</option><option value="soft">Soft</option></SelectInput>}</FormField>
        <FormField id="appearance-motion" label="Motion">{props => <SelectInput {...props} value={draft.motion ?? 'system'} onChange={event => change('motion', event.target.value as PersonalAppearancePreferences['motion'])}><option value="system">System</option><option value="reduced">Reduced</option></SelectInput>}</FormField>
      </div>
    </fieldset>
    <section aria-label="Appearance preview" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Preview</h2><div className="w-40"><FormField id="appearance-preview-scheme" label="Preview theme">{props => <SelectInput {...props} value={previewScheme} onChange={event => setPreviewScheme(event.target.value as 'light' | 'dark')}><option value="light">Light</option><option value="dark">Dark</option></SelectInput>}</FormField></div></div>
      <VisualScope selection={{ ...draft, appearance: previewScheme }} data-testid="appearance-preview" className="rounded-xl border border-border p-4 sm:p-6">
        <Card variant={draft.preset ? 'elevated' : 'default'} className="space-y-4">
          <h3 className="font-semibold">Your workspace</h3><p className="text-sm text-muted">Try these controls to see your selection in action.</p>
          <FormField id="appearance-example-input" label="Example input">{props => <TextInput {...props} placeholder="Enter a preview value" />}</FormField>
          <Toolbar><Tabs defaultValue="overview"><TabsList variant="segmented" aria-label="Preview views"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList><TabsContent value="overview">Overview preview</TabsContent><TabsContent value="activity">Activity preview</TabsContent></Tabs>
            <Popover><PopoverTrigger asChild><Button tone="secondary">Open preview filter</Button></PopoverTrigger><PopoverContent><p>Filters inherit your appearance.</p></PopoverContent></Popover>
          </Toolbar>
          <FormActions><Button type="button">Primary action</Button><Button type="button" tone="secondary" aria-pressed>Selected control</Button></FormActions>
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
