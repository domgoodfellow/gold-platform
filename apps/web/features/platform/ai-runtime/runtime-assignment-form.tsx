'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { saveRuntimeAssignmentAction } from '@/app/platform/ai-runtime/actions';
import { RUNTIME_ASSIGNMENT_FORM_INITIAL } from '@/app/platform/ai-runtime/action-states';
import type { AiCapability } from '@/lib/domain/ai/runtime';

export type RuntimeService = { id: string; providerKey: string; providerLabel: string; label: string };
export type RuntimeAccount = { id: string; providerKey: string; label: string; isUsable: boolean };

/**
 * Provider Service, Provider Account and model — one capability's whole assignment. The service
 * list is pre-filtered by the caller to implemented AI answering services only (never a provider
 * service this runtime cannot actually answer through); choosing one here filters the account list
 * to that service's own provider, so a cross-provider assignment is never representable in the
 * form even before the database refuses it.
 */
export function RuntimeAssignmentForm({
  capability,
  services,
  accounts,
  current,
}: {
  capability: AiCapability;
  services: RuntimeService[];
  accounts: RuntimeAccount[];
  current?: { providerServiceId: string; providerAccountId: string; model: string };
}) {
  const [state, action, pending] = useActionState(saveRuntimeAssignmentAction, RUNTIME_ASSIGNMENT_FORM_INITIAL);
  const [serviceId, setServiceId] = useState(current?.providerServiceId ?? services[0]?.id ?? '');
  const selectedService = services.find((service) => service.id === serviceId);
  const accountsForProvider = accounts.filter((account) => account.providerKey === selectedService?.providerKey);

  useEffect(() => {
    if (state.saved) toast.success('Runtime assignment saved.');
  }, [state]);

  if (services.length === 0) {
    return <Hint>No AI answering service is implemented yet.</Hint>;
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="capability" value={capability} />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="providerServiceId">Provider service</FieldLabel>
        <SelectInput
          id="providerServiceId"
          name="providerServiceId"
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
        >
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.providerLabel} — {service.label}
            </option>
          ))}
        </SelectInput>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="providerAccountId">Provider account</FieldLabel>
        {accountsForProvider.length === 0 ? (
          <Hint>No account configured for {selectedService?.providerLabel ?? 'this provider'} yet.</Hint>
        ) : (
          <SelectInput id="providerAccountId" name="providerAccountId" defaultValue={current?.providerAccountId ?? accountsForProvider[0]?.id}>
            {accountsForProvider.map((account) => (
              <option key={account.id} value={account.id} disabled={!account.isUsable}>
                {account.label}
                {account.isUsable ? '' : ' (not ready)'}
              </option>
            ))}
          </SelectInput>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="model">Model</FieldLabel>
        <TextInput id="model" name="model" required defaultValue={current?.model ?? ''} placeholder="e.g. gpt-5.5, claude-opus-5, gemini-3-pro" />
        <Hint>Runtime configuration, not a catalogue entry — vendors change these too often for one.</Hint>
      </div>
      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" className="w-fit" disabled={pending || accountsForProvider.length === 0}>
        {pending ? 'Saving…' : 'Save assignment'}
      </Button>
    </form>
  );
}
