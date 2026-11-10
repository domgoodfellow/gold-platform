'use client';
import { useEffect, useId, useState, type Dispatch, type SetStateAction } from 'react';
import { FormError, FormField } from '@/components/controls/form';
import { TextArea, TextInput } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import { callListTaskOptions } from '@/app/organizations/[organizationId]/calls/call-list-actions';
import type { CallListTaskDraft } from '@/lib/application/communications/call-list';

/** Shared task details for Contacts, a contact record and the Dialer's picker. */
export function CallListTaskFields({ organizationId, value, onChange, onDirty }: { organizationId: string; value: CallListTaskDraft; onChange: Dispatch<SetStateAction<CallListTaskDraft>>; onDirty: () => void }) {
  const prefix = useId();
  const [options, setOptions] = useState<Awaited<ReturnType<typeof callListTaskOptions>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void callListTaskOptions(organizationId).then(options => {
      if (!active) return;
      setOptions(options); onChange(value => ({ ...value, dueAt: value.dueAt || options.dueAt }));
    }).catch(() => { if (active) setError('Task options could not be loaded. Close and try again.'); });
    return () => { active = false; };
  }, [organizationId, onChange]);
  if (error) return <FormError>{error}</FormError>;
  if (!options) return <p role="status" className="text-sm text-muted">Loading task options…</p>;
  return <div className="space-y-4">
    <FormField id={`${prefix}-due`} label="Due" hint={options.timezone}>{props => <TextInput {...props} type="datetime-local" required value={value.dueAt} onChange={event => { onDirty(); onChange(value => ({ ...value, dueAt: event.target.value })); }} />}</FormField>
    <FormField id={`${prefix}-owner`} label="Owner">{props => <SelectField {...props} value={value.ownerMembershipId} onValueChange={ownerMembershipId => { onDirty(); onChange(value => ({ ...value, ownerMembershipId })); }} options={[{ value: '', label: 'Unassigned' }, ...options.members.map(member => ({ value: member.id, label: member.name }))]} />}</FormField>
    <FormField id={`${prefix}-notes`} label="Note" optional>{props => <TextArea {...props} rows={3} maxLength={10000} value={value.notes} onChange={event => { onDirty(); onChange(value => ({ ...value, notes: event.target.value })); }} />}</FormField>
  </div>;
}
