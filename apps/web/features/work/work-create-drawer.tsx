'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { SelectInput } from '@/components/controls/inputs';
import { PageDrawer, PageDrawerContent, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { CreateWorkItemForm } from './work-create-form';
import type { WorkCreateOptions } from '@/lib/application/work/create-options';
export type { WorkCreateOptions } from '@/lib/application/work/create-options';

export function WorkCreateDrawer({ options, defaultOpen = false }: { options: WorkCreateOptions; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [typeId, setTypeId] = useState(options.types[0]?.id ?? '');
  return <PageDrawer open={open} onOpenChange={setOpen}>
    <PageDrawerTrigger asChild><Button size="small"><Plus size={16} aria-hidden />New work</Button></PageDrawerTrigger>
    <PageDrawerContent><PageDrawerHeader><PageDrawerTitle>New work</PageDrawerTitle></PageDrawerHeader>
      {options.types.length ? <><label className="flex flex-col gap-1 text-sm">Work type<SelectInput value={typeId} onChange={e => setTypeId(e.target.value)}>{options.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectInput></label>
        <CreateWorkItemForm key={typeId} {...options} statuses={options.statusesByType[typeId] ?? []} />
      </> : <p className="text-sm text-muted">Configure a work type and its starting status before creating work.</p>}
    </PageDrawerContent>
  </PageDrawer>;
}
