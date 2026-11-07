'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { SuggestionField } from '@/components/controls/select-field';
import { FormField } from '@/components/controls/form';
import { Button } from '@/components/controls/button';
import { Card } from '@/components/surfaces/card';
import { SectionHeading } from '@/components/surfaces/section';
import { BusinessLocationFields } from '@/features/locale/location-fields';
import { updateOrganizationGeneralAction, type SettingsActionState } from '@/app/organizations/[organizationId]/settings/actions';
import { INDUSTRY_SUGGESTIONS } from '@/lib/domain/tenancy/industries';
import type { OrganizationIdentity } from '@/lib/domain/tenancy/identity';

const INITIAL: SettingsActionState & { saved: boolean } = { error: null, saved: false };
const SERVES = [['people', 'People'], ['companies', 'Companies'], ['both', 'Both']] as const;

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
  const contact = <BusinessContactCard identity={identity} />;

  return (
    <form action={formAction} onChange={() => setDirty(true)} className="flex flex-col gap-6">
      <input type="hidden" name="organizationId" value={organizationId} />

      <Card as="section" aria-labelledby="identity-heading">
        <div className="flex flex-col gap-4">
        <SectionHeading id="identity-heading">Business identity</SectionHeading>
        <FormField id="org-name" label="Business name">
          {(field) => <TextInput {...field} name="name" type="text" required maxLength={200} defaultValue={name} />}
        </FormField>
        <FormField id="org-legal-name" label="Legal name" optional hint="Only if it differs from the business name. Sole traders can leave this empty.">
          {(field) => <TextInput {...field} name="legalName" type="text" maxLength={200} defaultValue={identity.legalName ?? ''} />}
        </FormField>
        <FormField id="org-industry" label="Industry" optional>
          {(field) => <SuggestionField {...field} name="industry" type="text" maxLength={100} suggestions={INDUSTRY_SUGGESTIONS} defaultValue={identity.industry ?? ''} />}
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Who you serve</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {SERVES.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="serves" value={value} defaultChecked={identity.serves === value} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        </div>
      </Card>

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
        layout={({ location, regional }) => <>
          <Card as="section" aria-labelledby="address-heading">
            <div className="flex flex-col gap-4">
              <div>
                <SectionHeading id="address-heading">Primary business address</SectionHeading>
              </div>
              {location}
              <Hint>
                This address is private to your team.
                To show an address on your website, add it to the{' '}
                <Link href={`/organizations/${organizationId}/settings/public-profile`} className="text-accent-text hover:underline">public profile</Link>.
              </Hint>
            </div>
          </Card>
          {contact}
          <Card as="section" aria-labelledby="regional-heading">
            <div className="flex flex-col gap-3">
              <div>
                <SectionHeading id="regional-heading">Regional settings</SectionHeading>
                
              </div>
              {regional}
            </div>
          </Card>
        </>}
      />

      <div className="flex flex-col items-start gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
        <ErrorText role="alert">{state.error}</ErrorText>
        {state.saved && !dirty ? <p role="status" className="text-sm text-muted">Business profile saved.</p> : null}
      </div>
    </form>
  );
}

/** The business's own reachable details; separate from sign-in email and Communications numbers. */
function BusinessContactCard({ identity }: { identity: OrganizationIdentity }) {
  return (
      <Card as="section" aria-labelledby="contact-heading">
        <div className="flex flex-col gap-4">
        <div>
          <SectionHeading id="contact-heading">Business contact</SectionHeading>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="org-contact-email" label="Email" optional>
            {(field) => <TextInput {...field} name="contactEmail" type="email" maxLength={200} defaultValue={identity.contactEmail ?? ''} />}
          </FormField>
          <FormField id="org-contact-phone" label="Phone" optional>
            {(field) => <PhoneInput {...field} name="contactPhone" type="tel" maxLength={50} defaultValue={identity.contactPhone ?? ''} />}
          </FormField>
        </div>
        <FormField id="org-website" label="Website" optional>
          {(field) => <TextInput {...field} name="websiteUrl" type="text" inputMode="url" maxLength={300} defaultValue={identity.websiteUrl ?? ''} />}
        </FormField>
        <Hint>Separate from your sign-in email and the phone numbers Communications uses.</Hint>
        </div>
      </Card>
  );
}
