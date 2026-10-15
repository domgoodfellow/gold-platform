'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { Button } from '@/components/controls/button';
import { SectionHeading } from '@/components/surfaces/section';
import { BusinessLocationFields } from '@/features/locale/location-fields';
import { updateOrganizationGeneralAction, type SettingsActionState } from '@/app/organizations/[organizationId]/settings/actions';
import { INDUSTRY_SUGGESTIONS } from '@/lib/domain/tenancy/industries';
import type { OrganizationIdentity } from '@/lib/domain/tenancy/identity';

const INITIAL: SettingsActionState & { saved: boolean } = { error: null, saved: false };

/**
 * The business profile: who the business is, where it is, how it can be reached and which clock and
 * currency it runs on. Settings → General and Setup render this same form against the same action,
 * so there is one place the profile is written. Everything here is private to the team; what the
 * public sees is the Public profile, which the business fills in deliberately.
 */
export function OrganizationSettingsForm({
  organizationId,
  name,
  timezone,
  currency,
  identity,
}: {
  organizationId: string;
  name: string;
  timezone: string;
  /** Null when this business has not said yet — signing up no longer asks. */
  currency: string | null;
  identity: OrganizationIdentity;
}) {
  const [dirty, setDirty] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: typeof INITIAL, data: FormData) => {
    const result = await updateOrganizationGeneralAction(previous, data);
    if (!result.error) setDirty(false);
    return { ...result, saved: !result.error };
  }, INITIAL);

  return (
    <form action={formAction} onChange={() => setDirty(true)} className="flex flex-col gap-10">
      <input type="hidden" name="organizationId" value={organizationId} />

      <section aria-labelledby="identity-heading" className="flex flex-col gap-4">
        <SectionHeading id="identity-heading">Business identity</SectionHeading>
        <FormField id="org-name" label="Business name">
          {(field) => <TextInput {...field} name="name" type="text" required maxLength={200} defaultValue={name} />}
        </FormField>
        <FormField id="org-legal-name" label="Legal name" optional hint="Only if it differs from the business name. Sole traders can leave this empty.">
          {(field) => <TextInput {...field} name="legalName" type="text" maxLength={200} defaultValue={identity.legalName ?? ''} />}
        </FormField>
        <FormField id="org-industry" label="Industry" optional>
          {(field) => (
            <>
              <TextInput {...field} name="industry" type="text" maxLength={100} list="org-industry-suggestions" defaultValue={identity.industry ?? ''} />
              <datalist id="org-industry-suggestions">
                {INDUSTRY_SUGGESTIONS.map((industry) => <option key={industry} value={industry} />)}
              </datalist>
            </>
          )}
        </FormField>
      </section>

      <section aria-labelledby="address-heading" className="flex flex-col gap-4">
        <div>
          <SectionHeading id="address-heading">Primary business address</SectionHeading>
          <Hint className="mt-1">
            This address is private to your team.
            To show an address on your website, add it to the{' '}
            <Link href={`/organizations/${organizationId}/settings/public-profile`} className="text-accent-text hover:underline">public profile</Link>.
          </Hint>
        </div>
        <BusinessLocationFields
          mode="edit"
          initial={{ countryCode: identity.countryCode ?? '', region: identity.region ?? '', city: identity.city ?? '', postalCode: identity.postalCode ?? '' }}
          initialTimeZone={timezone}
          initialCurrency={currency}
          streetFields={
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <FormField id="org-address-1" label="Street address" optional>
                {(field) => <TextInput {...field} name="addressLine1" autoComplete="address-line1" maxLength={200} defaultValue={identity.addressLine1 ?? ''} />}
              </FormField>
              <FormField id="org-address-2" label="Unit or suite" optional>
                {(field) => <TextInput {...field} name="addressLine2" autoComplete="address-line2" maxLength={100} defaultValue={identity.addressLine2 ?? ''} />}
              </FormField>
            </div>
          }
        />
      </section>

      <section aria-labelledby="contact-heading" className="flex flex-col gap-4">
        <div>
          <SectionHeading id="contact-heading">Business contact</SectionHeading>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="org-contact-email" label="Email" optional>
            {(field) => <TextInput {...field} name="contactEmail" type="email" maxLength={200} defaultValue={identity.contactEmail ?? ''} />}
          </FormField>
          <FormField id="org-contact-phone" label="Phone" optional>
            {(field) => <TextInput {...field} name="contactPhone" type="tel" maxLength={50} defaultValue={identity.contactPhone ?? ''} />}
          </FormField>
        </div>
        <FormField id="org-website" label="Website" optional>
          {(field) => <TextInput {...field} name="websiteUrl" type="text" inputMode="url" maxLength={300} defaultValue={identity.websiteUrl ?? ''} />}
        </FormField>
        <details className="text-sm text-muted">
          <summary className="min-h-11 cursor-pointer content-center rounded-md focus-visible:outline-2 focus-visible:outline-ring">About business contact details</summary>
          <p className="mt-2">These details are separate from your sign-in email and the phone numbers Communications runs. You can use an existing website address.</p>
        </details>
      </section>

      <div className="flex flex-col items-start gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
        <ErrorText role="alert">{state.error}</ErrorText>
        {state.saved && !dirty ? <p role="status" className="text-sm text-muted">Business profile saved.</p> : null}
      </div>
    </form>
  );
}
