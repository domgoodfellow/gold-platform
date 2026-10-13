'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput } from '@/components/controls/inputs';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { CreateWorkItemForm } from './work-create-form';
import type { WorkCreateOptions } from '@/lib/application/work/create-options';
export type { WorkCreateOptions } from '@/lib/application/work/create-options';

/** `configureHref` is passed only to people who may manage work types; without it no configuration action is offered. */
export function WorkCreateDrawer({ options, defaultOpen = false, initialTypeId, configureHref }: { options: WorkCreateOptions; defaultOpen?: boolean; initialTypeId?: string; configureHref?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const [typeId, setTypeId] = useState(options.types.some(t => t.id === initialTypeId) ? initialTypeId! : options.types[0]?.id ?? '');
  const statuses = options.statusesByType[typeId] ?? [];
  return <PageDrawer open={open} onOpenChange={setOpen}>
    <PageDrawerTrigger asChild><Button size="small"><Plus size={16} aria-hidden />New work</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>New work</PageDrawerTitle></PageDrawerHeader>
      {options.types.length ? <>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Work type<SelectInput value={typeId} onChange={e => setTypeId(e.target.value)}>{options.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectInput></label>
          {configureHref ? <ButtonLink size="small" tone="secondary" href={`${configureHref}?new=1`}>Create work type</ButtonLink> : null}
        </div>
        <CreateWorkItemForm key={typeId} {...options} statuses={statuses} />
        {!statuses.length && configureHref ? <ButtonLink size="small" tone="secondary" href={`${configureHref}?type=${typeId}&tab=workflow`}>Add a stage</ButtonLink> : null}
      </> : <>
        <p className="text-sm text-muted">Configure a work type and its starting status before creating work.</p>
        {configureHref ? <ButtonLink size="small" href={`${configureHref}?new=1`}>Create work type</ButtonLink> : null}
      </>}
    </PageDrawerContent>
  </PageDrawer>;
}
