'use client';

import { useState } from 'react';
import { ButtonLink } from '@/components/controls/button';
import { SelectInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { OperationalPanel } from '@/components/operational/primitives';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { CreateWorkItemForm } from './work-create-form';
import type { WorkCreateOptions } from '@/lib/application/work/create-options';

export function WorkCreatePage({ options, initialTypeId, mayConfigure }: { options: WorkCreateOptions; initialTypeId?: string; mayConfigure: boolean }) {
  const [typeId, setTypeId] = useState(options.types.find(t => t.id === initialTypeId)?.id ?? options.types.find(t => options.statusesByType[t.id]?.length)?.id ?? options.types[0]?.id ?? '');
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const selected = options.types.find(t => t.id === typeId);
  const statuses = options.statusesByType[typeId] ?? [];
  const base = `/organizations/${options.organizationId}/work`;
  return <OperationalPanel title="New work">
    <div className="space-y-4">
      {selected ? <FormField id="new-work-type" label="Work type">{field =>
        <SelectInput {...field} value={typeId} onChange={event => {
          if (dirty && !window.confirm('Discard unsaved work and change Work type?')) return;
          setDirty(false);
          setTypeId(event.target.value);
          const url = new URL(window.location.href);
          url.searchParams.set('type', event.target.value);
          window.history.replaceState(null, '', url);
        }}>{options.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectInput>
      }</FormField> : null}
      {selected && statuses.length ? <CreateWorkItemForm key={typeId} {...options} statuses={statuses} onDirtyChange={setDirty} cancelHref={`${base}?${new URLSearchParams({ type: typeId })}`} /> : <div className="space-y-3" role="status">
        <p className="font-medium">{selected ? `${selected.name} needs a starting stage` : 'No work types yet'}</p>
        <p className="text-sm text-muted">{selected ? 'A starting stage is required before work of this type can be created.' : 'A Work type and a starting stage are required before creating work.'} {mayConfigure ? '' : 'An administrator must configure the type.'}</p>
        {options.types.some(t => t.id !== typeId && options.statusesByType[t.id]?.length) ? <p className="text-sm text-muted">Select another configured Work type above to continue.</p> : null}
        <div className="flex flex-wrap gap-2">
          {mayConfigure ? <ButtonLink size="small" href={`${base}/configuration?${selected ? new URLSearchParams({ type: typeId, tab: 'workflow', returnTo: 'create' }) : 'new=1&returnTo=create'}`}>{selected ? 'Configure stages' : 'Create work type'}</ButtonLink> : null}
          <ButtonLink size="small" tone="secondary" href={base}>Cancel</ButtonLink>
        </div>
      </div>}
    </div>
  </OperationalPanel>;
}
