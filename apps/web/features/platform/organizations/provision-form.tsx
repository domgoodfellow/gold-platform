'use client';

import { Button } from '@/components/controls/button';
import { SectionHeading } from '@/components/surfaces/section';
import { ErrorText, FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { CurrencyField, TimeZoneField } from '@/features/locale/locale-fields';
import { SelectField } from '@/components/controls/select-field';
import { provisionOrganizationAction, type ProvisionState } from '@/app/platform/actions';

const INITIAL: ProvisionState = { error: null, provisioned: null };

/**
 * Handing a business over, which is what actually happens at the end of a sales call.
 *
 * It asks the same four things `CreateOrganizationForm` asks, plus the one that makes it the
 * operator door rather than the other one: **whose business it is**. The staff member filling
 * this in is not going to be a member of what they create.
 *
 * **The two forms are not extracted into one shared control, and that is the UI system rather than an
 * oversight** — a component is extracted at the third caller. There are two, they ask different
 * questions of different people, and folding them together now would produce one form with a
 * mode flag, which is the shape the one-creation-path rule spent a record arguing against at the layer below this one.
 */
export function ProvisionForm({ compact = false, templates = [] }: { compact?: boolean; templates?: { key: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(provisionOrganizationAction, INITIAL);
  // Keyed on the whole result, so provisioning a second business with the same name still says so.
  useEffect(() => {
    if (state.provisioned) toast.success(`${state.provisioned} created. The owner reviews the setup when they first sign in.`);
  }, [state]);

  return (
    <form action={formAction} className={compact ? 'flex flex-col gap-4' : 'mt-8 flex flex-col gap-4'}>
      {!compact ? <SectionHeading>Provision a business</SectionHeading> : null}

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <FieldLabel htmlFor="name">
            What is it called?
          </FieldLabel>
          <TextInput
            id="name"
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="Northern Plant Services"
          />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <FieldLabel htmlFor="ownerEmail">
            Who does it belong to?
          </FieldLabel>
          <TextInput
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            required
            placeholder="sam@northernplant.example"
          />
          {/*
            The precondition is real and is stated rather than discovered: a membership
            references `auth.users`, so the owner has to have signed up. It is the same thing
            `addMember` says, and creating the account for them would need the admin API, which
            this app may not hold.
          */}
          <Hint weight="subtle" className="text-xs">
            They need an account already — ask them to sign up first.
          </Hint>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <FieldLabel htmlFor="displayName">
            Name in this business (optional)
          </FieldLabel>
          <TextInput
            id="displayName"
            name="displayName"
            type="text"
            maxLength={120}
            placeholder="Sam Okafor"
          />
          <Hint weight="subtle" className="text-xs">
            Leave blank to use their personal profile name.
          </Hint>
        </div>

        {/*
          UTC rather than our own zone. `TimeZoneField` preselects the reader's browser zone,
          which is the right answer when somebody founds their own business and the wrong one
          here — the browser belongs to us, and a business in Montreal would arrive on a London
          clock because of where a staff member happened to be sitting.
        */}
        <TimeZoneField defaultValue="UTC" label="Where is the business?" />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <CurrencyField />
        {/* Offered, never applied: the owner sees it first and confirms or changes it. */}
        <div className="flex flex-1 flex-col gap-1">
          <FieldLabel htmlFor="templateKey">Starting setup (optional)</FieldLabel>
          <SelectField id="templateKey" name="templateKey" defaultValue=""
            options={[{ value: '', label: 'None' }, ...templates.map((template) => ({ value: template.key, label: template.name }))]} />
          <Hint weight="subtle" className="text-xs">The owner reviews it before anything is set up.</Hint>
        </div>
      </div>

      <ErrorText>{state.error}</ErrorText>

      <Button
        type="submit"
        disabled={pending}
        className="w-fit text-sm dark:bg-white dark:text-black"
      >
        {pending ? 'Provisioning…' : 'Provision'}
      </Button>
    </form>
  );
}
