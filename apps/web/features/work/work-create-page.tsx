'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { Card } from '@/components/surfaces/card';
import { SectionHeading } from '@/components/surfaces/section';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { CreateWorkItemForm } from './work-create-form';
import { StartingStageForm } from './starting-stage-form';
import { CreateTypeForm } from './configuration/work-config-forms';
import type { WorkCreateOptions } from '@/lib/application/work/create-options';
import { withSetupContext } from '@/lib/route/setup-context';
import { SelectField } from '@/components/controls/select-field';

/**
 * New work, on its own bounded page. A type without a starting stage can never create work; a member
 * who configures Work adds that stage (or the first type) here, through the same actions and policies
 * as Work type settings, and lands straight back on the form with the type still chosen. Anybody
 * else is told what is missing and offered any type that is ready.
 */
export function WorkCreatePage({ options, initialTypeId, delivery, initialServiceId, initialCustomerId, mayConfigure, returnToQuote = false, setupStep }: { options: WorkCreateOptions; delivery?: { proposalId: string; position: number; customerId: string; name: string }; initialTypeId?: string; initialServiceId?: string; initialCustomerId?: string; mayConfigure: boolean; returnToQuote?: boolean; setupStep?: string }) {
  const router = useRouter();
  const ready = (id: string) => (options.statusesByType[id]?.length ?? 0) > 0;
  const [serviceId, setServiceId] = useState(initialServiceId ?? '');
  const service = options.services?.find(item => item.id === serviceId);
  const [typeId, setTypeId] = useState(options.types.find(t => t.id === (service?.deliveryTypeId ?? initialTypeId))?.id ?? '');
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const selected = options.types.find(t => t.id === typeId);
  const statuses = options.statusesByType[typeId] ?? [];
  const base = `/organizations/${options.organizationId}/work`;
  const chooseType = (next: string) => {
    setTypeId(next);
    const url = new URL(window.location.href);
    url.searchParams.set('type', next);
    window.history.replaceState(null, '', url);
  };
  const otherReady = options.types.some(t => t.id !== typeId && ready(t.id));
  const settingsQuery = new URLSearchParams(selected ? { type: typeId, tab: 'workflow', returnTo: 'create' } : { new: '1', returnTo: 'create' });
  if (returnToQuote) settingsQuery.set('quote', '1');
  const settingsHref = setupStep ? withSetupContext(`${base}/configuration?${settingsQuery}`, setupStep) : `${base}/configuration?${settingsQuery}`;
  const newTypeQuery = new URLSearchParams({ new: '1', returnTo: 'create', ...(returnToQuote ? { quote: '1' } : {}) });
  const newTypePath = `${base}/configuration?${newTypeQuery}`;
  const newTypeHref = setupStep ? withSetupContext(newTypePath, setupStep) : newTypePath;
  const destination = returnToQuote ? `/organizations/${options.organizationId}/finance/quotes?create=1&quoteSource=work` : typeId ? `${base}?${new URLSearchParams({ type: typeId })}` : base;
  const cancelHref = setupStep ? withSetupContext(destination, setupStep) : destination;

  return <Card as="section" aria-label="New work">
    <div className="flex flex-col gap-5">
      {!delivery && options.services?.some(item => item.deliveryTypeId) ? <FormField id="new-work-service" label="Catalog service" optional>{field => <SelectField {...field} value={serviceId} onValueChange={next => {
        if (dirty && !window.confirm('Discard unsaved work and change service?')) return;
        setDirty(false); setServiceId(next);
        const url = new URL(window.location.href);
        if (next) url.searchParams.set('service', next); else url.searchParams.delete('service');
        window.history.replaceState(null, '', url);
        const linked = options.services?.find(item => item.id === next)?.deliveryTypeId;
        if (linked) chooseType(linked);
      }} options={[{ value: '', label: 'No catalog service' }, ...(options.services ?? []).filter(item => options.types.some(type => type.id === item.deliveryTypeId)).map(item => ({ value: item.id, label: item.name }))]} />}</FormField> : null}
      {delivery ? <p className="text-sm">Delivery for {delivery.name}. The accepted quote keeps its prices; invoice it from the customer&rsquo;s quote.</p> : null}
      {options.types.length ? <FormField id="new-work-type" label="Work type">{field =>
        <SelectField {...field} disabled={Boolean(delivery)} value={typeId} onValueChange={(next) => {
          if (dirty && !window.confirm('Discard unsaved work and change Work type?')) return;
          setDirty(false);
          if (service && service.deliveryTypeId !== next) {
            setServiceId('');
            const url = new URL(window.location.href); url.searchParams.delete('service');
            window.history.replaceState(null, '', url);
          }
          chooseType(next);
        }} options={[{ value: '', label: 'Choose a Work type' }, ...options.types.map((t) => ({ value: t.id, label: ready(t.id) ? t.name : `${t.name} (needs a starting stage)` }))]} />
      }</FormField> : null}

      {mayConfigure && options.types.length ? <ButtonLink size="small" tone="secondary" href={newTypeHref} className="w-fit">New Work type</ButtonLink> : null}

      {returnToQuote ? <Hint>Create the Work item, then continue to its Financials to add a quoted price.</Hint> : null}
      {selected && statuses.length ? <CreateWorkItemForm key={`${typeId}:${serviceId}`} {...options} typeId={typeId} statuses={statuses} onDirtyChange={setDirty} cancelHref={cancelHref} returnToQuote={returnToQuote || Boolean(service) || Boolean(delivery)} setupStep={setupStep} service={service} initialCustomerId={delivery?.customerId ?? initialCustomerId} delivery={delivery} />
        : <div className="flex flex-col gap-4" role="region" aria-labelledby="new-work-prerequisite">
          <div>
            <SectionHeading id="new-work-prerequisite">{selected ? `${selected.name} needs a starting stage` : options.types.length ? 'Choose a Work type' : 'No work types yet'}</SectionHeading>
          </div>
          {!selected && options.types.length ? null : mayConfigure
            ? selected
              ? <StartingStageForm key={typeId} organizationId={options.organizationId} typeId={typeId} typeName={selected.name} onAdded={() => router.refresh()} />
              : <CreateTypeForm organizationId={options.organizationId} onCreated={created => { chooseType(created); router.refresh(); }} />
            : <p className="text-sm">Someone who manages Work has to finish setting up this kind of work. Ask someone who manages Work types to {selected ? 'add a starting stage to it' : 'add one'}.</p>}
          {otherReady ? <Hint>Or choose a Work type that is ready from the list above.</Hint> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
            <ButtonLink size="small" tone="secondary" href={cancelHref}>Cancel</ButtonLink>
            {mayConfigure ? <Link href={settingsHref} className="text-accent-text underline-offset-4 hover:underline">Open Work type settings</Link> : null}
          </div>
        </div>}
    </div>
  </Card>;
}
