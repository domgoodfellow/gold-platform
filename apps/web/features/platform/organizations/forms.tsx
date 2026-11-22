'use client';

import { useActionState, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import {
  provisionTwilioAction,
  registerPhoneNumberAction,
  setResourceStatusAction,
  saveAsTemplateAction,
} from '@/app/organizations/[organizationId]/administration/organizations/[targetOrganizationId]/actions';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/controls/confirm-submit';
import { FieldLabel, TextArea } from '@/components/controls/inputs';
import { SuggestionField } from '@/components/controls/select-field';
import { INDUSTRY_SUGGESTIONS } from '@/lib/domain/tenancy/industries';
import {
  PROVISION_TWILIO_INITIAL,
  SAVE_TEMPLATE_INITIAL,
  REGISTER_RESOURCE_INITIAL,
  SET_RESOURCE_STATUS_INITIAL,
} from '@/app/organizations/[organizationId]/administration/organizations/[targetOrganizationId]/action-states';
import { SelectField } from '@/components/controls/select-field';

export function ProvisionTwilioForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(provisionTwilioAction, PROVISION_TWILIO_INITIAL);
  return <form action={action} className="flex flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><ErrorText>{state.error}</ErrorText>{state.provisioned ? <p className="text-sm text-muted-foreground">Provisioned.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Provisioning…' : 'Provision Twilio subaccount'}</Button></form>;
}

export function RegisterPhoneNumberForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(registerPhoneNumberAction, REGISTER_RESOURCE_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><TextInput name="number" required placeholder="+14165550142" aria-label="Phone number" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Register number'}</Button></form>;
}

export function SetResourceStatusForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(setResourceStatusAction, SET_RESOURCE_STATUS_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><TextInput name="resourceId" required placeholder="Resource ID" /><SelectField name="status" required aria-label="Status" options={[{ value: '', label: 'Status…' }, { value: 'active', label: 'Active / verified' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }, { value: 'disabled', label: 'Disabled' }]} /><TextInput name="errorDetail" placeholder="Error detail, if failed" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Update resource'}</Button></form>;
}


/**
 * Save this business's setup as a starting template. It is saved unpublished: owners never see it
 * until it is published from Products. Its customers, jobs and money are never part of it.
 */
export function SaveTemplateDialog({ organizationId, businessName, industry }: { organizationId: string; businessName: string; industry: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (previous: typeof SAVE_TEMPLATE_INITIAL, data: FormData) => {
    const result = await saveAsTemplateAction(previous, data);
    if (!result.error) {
      toast.success(`${result.saved} saved. Publish it from Products to offer it to new businesses.`);
      setOpen(false);
    }
    return result;
  }, SAVE_TEMPLATE_INITIAL);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" tone="secondary" size="small">Save as template</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save {businessName} as a template</DialogTitle>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="template-name">Name</FieldLabel>
            <TextInput id="template-name" name="name" required maxLength={120} defaultValue={businessName} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="template-category">Category</FieldLabel>
            <SuggestionField id="template-category" name="category" required maxLength={60} suggestions={INDUSTRY_SUGGESTIONS} defaultValue={industry ?? ''} />
            <Hint>A new owner who gives this industry has it chosen for them.</Hint>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="template-description">Description</FieldLabel>
            <TextArea id="template-description" name="description" required maxLength={300} rows={3} />
            <Hint>Owners read this when choosing a starting point.</Hint>
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save template'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
