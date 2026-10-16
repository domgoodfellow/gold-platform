'use client';

import { ViewNav } from '@/components/navigation/view-nav';
import { NavigationList } from '@/components/navigation/navigation-list';
import { useId, useState } from 'react';
import { VISUAL_PRESETS, type VisualPreset, type Appearance, type Density } from '@gold/ui/design-system';
import { VisualScope } from '@gold/ui/components/visual-scope';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@gold/ui/components/tabs';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@gold/ui/components/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@gold/ui/components/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@gold/ui/components/popover';
import { Alert, AlertTitle } from '@gold/ui/components/alert';
import { FieldGroup } from '@gold/ui/components/field';
import { Button } from '@/components/controls/button';
import { TextInput, SelectInput } from '@/components/controls/inputs';
import { FormField, FormActions } from '@/components/controls/form';
import { SelectableCard } from '@/components/controls/selectable-card';
import { Card } from '@/components/surfaces/card';
import { KpiCard } from '@/components/surfaces/kpi-card';
import { Toolbar } from '@/components/display/data';
import { OperationalPanel, StatePill, FilterMenu } from '@/components/operational/primitives';

function Examples({ preset, appearance, density }: { preset: VisualPreset; appearance: Exclude<Appearance, 'system'>; density: Density }) {
  const id = useId();
  const [surface, setSurface] = useState('services');
  const [filter, setFilter] = useState('all');
  const [saved, setSaved] = useState(false);
  return <VisualScope role="region" selection={{ preset, appearance, density }} className="min-w-0 rounded-xl border border-border p-4 sm:p-6" aria-label={`${VISUAL_PRESETS[preset].label} ${appearance}`}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-[length:var(--type-display)] font-semibold">{VISUAL_PRESETS[preset].label}</h2>
      <span className="text-sm text-muted capitalize">{appearance} · {density}</span>
    </div>
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <OperationalPanel title={`${VISUAL_PRESETS[preset].label} ${appearance} settings form`} variant="elevated">
        <form onSubmit={(event) => { event.preventDefault(); setSaved(true); }}>
            <FieldGroup variant="inset">
            <FormField id={`${id}-name`} label="Display name" hint="Preview input only; nothing is persisted.">{(props) => <TextInput {...props} defaultValue="Design preview" />}</FormField>
            <FormField id={`${id}-email`} label="Contact email" error="Enter a valid email address.">{(props) => <TextInput {...props} variant="filled" defaultValue="example" />}</FormField>
            <FormField id={`${id}-disabled`} label="Read-only configuration">{(props) => <TextInput {...props} disabled value="Managed elsewhere" />}</FormField>
            <FormActions><Button type="submit">Preview save</Button><Button type="button" loading>Saving…</Button></FormActions>
            {saved && <p role="status">Preview saved locally.</p>}
          </FieldGroup>
        </form>
      </OperationalPanel>
      <div className="grid content-start gap-5">
        <section aria-label={`${preset} ${appearance} domain surface selector`}>
          <h3 className="mb-2 text-[length:var(--type-title)] font-semibold">Domain surface selector</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {['services', 'products'].map((value) => <SelectableCard key={value} selected={surface === value} onClick={() => setSurface(value)}>
              <span className="capitalize">{value}</span><span className="text-xs font-normal text-muted">{surface === value ? 'Selected surface' : 'Choose surface'}</span>
            </SelectableCard>)}
          </div>
        </section>
        <KpiCard kpi={{ key: 'preview', label: 'KPI preview', value: '—', note: 'No operational data loaded', href: '#gallery-controls' }} />
        <Toolbar variant="outlined" role="group" aria-label="Scheduling toolbar">
          <Tabs defaultValue="week"><TabsList variant="segmented" aria-label="Schedule period"><TabsTrigger value="day">Day</TabsTrigger><TabsTrigger value="week">Week</TabsTrigger><TabsTrigger value="month" disabled>Month</TabsTrigger></TabsList><TabsContent value="day">Day preview</TabsContent><TabsContent value="week">Week preview</TabsContent></Tabs>
          <FilterMenu label="Resource filter" value={filter} onValueChange={setFilter} options={[{ value: 'all', label: 'All resources' }, { value: 'mine', label: 'Assigned to me' }]} />
        </Toolbar>
      </div>
      <Card variant="quiet"><h3 className="mb-3 font-semibold">Navigation</h3>
        <ViewNav label={`${preset} ${appearance} sibling views`} current="files" views={['Home', 'Files', 'Media', 'Templates', 'Knowledge', 'Collections', 'Sources', 'Imports', 'Trash'].map(label => ({ key: label.toLowerCase(), label, href: `/dev/design-system?view=${label.toLowerCase()}#gallery-controls` }))} />
        <NavigationList label={`${preset} ${appearance} destinations`} density="compact" current="files" className="sm:grid-cols-2" items={[
          { key: 'files', title: 'Files', description: 'Shared content', href: '/dev/design-system?view=files#gallery-controls', chevron: true },
          { key: 'media', title: 'Media', href: '/dev/design-system?view=media#gallery-controls', chevron: true },
        ]} />
      </Card>
      <Card variant="quiet"><h3 className="mb-3 font-semibold">Control states</h3><div className="flex flex-wrap gap-2">
        <Button>Primary</Button><Button tone="secondary">Outline</Button><Button tone="soft">Soft</Button><Button tone="ghost">Ghost</Button><Button tone="danger">Destructive</Button><Button disabled>Disabled</Button><Button tone="secondary" aria-pressed>Pressed</Button>
      </div><div className="mt-4 flex flex-wrap gap-2">{(['neutral', 'success', 'warning', 'danger'] as const).map((tone) => <StatePill key={tone} tone={tone}>{tone}</StatePill>)}</div>
        <Tabs defaultValue="overview" className="mt-4"><TabsList variant="line" aria-label="Example detail views"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList><TabsContent value="overview">Line tabs preview</TabsContent><TabsContent value="activity">No activity loaded</TabsContent></Tabs>
      </Card>
      <Card variant="outlined"><h3 className="mb-3 font-semibold">Overlays and feedback</h3><div className="flex flex-wrap gap-2">
        <Dialog><DialogTrigger asChild><Button tone="secondary">Open modal</Button></DialogTrigger><DialogContent><DialogTitle>Design preview modal</DialogTitle><DialogDescription>Keyboard focus stays inside this modal. Escape closes it.</DialogDescription><FormField id={`${id}-modal`} label="Preview value">{(props) => <TextInput {...props} />}</FormField></DialogContent></Dialog>
        <DropdownMenu><DropdownMenuTrigger asChild><Button tone="secondary">Open menu</Button></DropdownMenuTrigger><DropdownMenuContent density="comfortable"><DropdownMenuItem onSelect={() => setSaved(true)}>Preview action</DropdownMenuItem><DropdownMenuItem disabled>Unavailable action</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => setSaved(false)}>Clear preview</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <Popover><PopoverTrigger asChild><Button tone="secondary">Open popover</Button></PopoverTrigger><PopoverContent variant="compact"><p>Shared surface and elevation tokens.</p></PopoverContent></Popover>
      </div><div className="mt-4 grid gap-2">{(['success', 'warning', 'destructive'] as const).map((variant) => <Alert key={variant} variant={variant} role="status"><AlertTitle>{variant === 'success' ? 'Preview complete' : variant === 'warning' ? 'Review required' : 'Preview error: retry available'}</AlertTitle></Alert>)}</div></Card>
      <Card variant="accent"><h3 className="font-semibold">Accent surface</h3><p className="text-muted">Interaction emphasis retains neutral text and semantic feedback.</p></Card>
    </div>
  </VisualScope>;
}

export function DesignGallery() {
  const [density, setDensity] = useState<Density>('comfortable');
  return <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-8">
    <header id="gallery-controls" className="space-y-3"><h1 className="text-3xl font-semibold">Visual system preview</h1><p className="text-muted">Development examples. Hover, press, tab through controls and open overlays. No business data is read or saved.</p>
      <FormField id="gallery-density" label="Component density">{(props) => <SelectInput {...props} value={density} onChange={(event) => setDensity(event.target.value as Density)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></SelectInput>}</FormField>
    </header>
    {(Object.keys(VISUAL_PRESETS) as VisualPreset[]).flatMap((preset) => (['light', 'dark'] as const).map((appearance) => <Examples key={`${preset}-${appearance}`} preset={preset} appearance={appearance} density={density} />))}
  </main>;
}
