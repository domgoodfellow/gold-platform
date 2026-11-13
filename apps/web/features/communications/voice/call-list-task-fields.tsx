'use client';
import { useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react';
import { FormError, FormField } from '@/components/controls/form';
import { TextArea, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { callListTaskOptions } from '@/app/organizations/[organizationId]/calls/call-list-actions';
import type { CallListTaskDraft } from '@/lib/application/communications/call-list';

export type CallListTaskOptions = Awaited<ReturnType<typeof callListTaskOptions>>;

/** Shared task details for Contacts, a contact record and the Dialer's Add to list. `onLoaded` hands the loaded owners and time zone to a caller that shows them back, such as a review step. */
export function CallListTaskFields({ organizationId, value, onChange, onDirty, onLoaded }: { organizationId: string; value: CallListTaskDraft; onChange: Dispatch<SetStateAction<CallListTaskDraft>>; onDirty: () => void; onLoaded?: (options: CallListTaskOptions) => void }) {
  const prefix = useId();
  const [options, setOptions] = useState<CallListTaskOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void callListTaskOptions(organizationId).then(options => {
      if (!active) return;
      setOptions(options); onLoaded?.(options); onChange(value => ({ ...value, dueAt: value.dueAt || options.dueAt }));
    }).catch(() => { if (active) setError('Task options could not be loaded. Close and try again.'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaded once per business; a caller's new `onLoaded` does not reload.
  }, [organizationId, onChange]);
  if (error) return <FormError>{error}</FormError>;
  if (!options) return <p role="status" className="text-sm text-muted">Loading task options…</p>;
  return <div className="space-y-4">
    <FormField id={`${prefix}-due`} label="Due" hint={options.timezone}>{props => <TextInput {...props} type="datetime-local" required value={value.dueAt} onChange={event => { onDirty(); onChange(value => ({ ...value, dueAt: event.target.value })); }} />}</FormField>
    <FormField id={`${prefix}-owner`} label="Owner">{props => <SelectField {...props} value={value.ownerMembershipId} onValueChange={ownerMembershipId => { onDirty(); onChange(value => ({ ...value, ownerMembershipId })); }} options={[{ value: '', label: 'Unassigned' }, ...options.members.map(member => ({ value: member.id, label: member.name }))]} />}</FormField>
    <FormField id={`${prefix}-notes`} label="Note" optional>{props => <TextArea {...props} rows={3} maxLength={10000} value={value.notes} onChange={event => { onDirty(); onChange(value => ({ ...value, notes: event.target.value })); }} />}</FormField>
  </div>;
}
