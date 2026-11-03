'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { Section, SectionHeading } from '@/components/surfaces/section';
import {
  addEmailAddressAction,
  setEmailReceivingAction,
  type EmailDomainState,
} from '@/app/organizations/[organizationId]/settings/email/actions';
import type { EmailIdentityView } from '@/lib/domain/email/identities';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: EmailDomainState = { error: null, notice: null, done: false };

const READINESS_LABEL: Record<EmailIdentityView['readiness']['state'], string> = {
  ready: 'Ready to send',
  pending: 'Waiting for its domain',
  unavailable: 'Cannot send',
};

function ReceivingToggle({ organizationId, identity }: { organizationId: string; identity: EmailIdentityView }) {
  const [state, run, pending] = useActionState(setEmailReceivingAction, INITIAL);
  return (
    <form action={run} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="emailIdentityId" value={identity.id} />
      <input type="hidden" name="canReceive" value={identity.canReceive ? 'false' : 'true'} />
      <span className="text-sm">{identity.canReceive ? 'On' : 'Off'}</span>
      <Button type="submit" tone="secondary" size="small" disabled={pending}>
        {identity.canReceive ? 'Turn off' : 'Turn on'}
      </Button>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

export function AddAddressForm({ organizationId, domains }: { organizationId: string; domains: { resourceId: string; domain: string; ready: boolean }[] }) {
  const [state, run, pending] = useActionState(addEmailAddressAction, INITIAL);
  const usable = domains.filter((domain) => domain.ready);

  if (usable.length === 0) {
    return (
      <Hint className="mt-3">
        No sending domain is verified yet, so there is nothing to put an address beneath. Verify one above first.
      </Hint>
    );
  }

  return (
    <form action={run} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="flex flex-wrap items-center gap-2">
        <TextInput name="local" required autoComplete="off" placeholder="hello" aria-label="Address, before the @" className="w-40" />
        <span aria-hidden>@</span>
        <SelectField name="resourceId" aria-label="Verified domain" required options={[...usable.map((domain) => ({ value: domain.resourceId, label: domain.domain }))]} />
        <TextInput name="displayName" autoComplete="off" placeholder="Name shown to the recipient (optional)" aria-label="Display name" className="w-full max-w-72" />
        <Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add address'}</Button>
      </div>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

/**
 * The addresses this business speaks as, beneath its verified sending domains.
 *
 * Three different things are named here and kept apart in the words: a *domain* is the provider's
 * permission for addresses beneath a name; an *address* is one of those, named by the business and
 * able to send once its domain is verified; and *receiving* is the business stating that mail for the
 * address is pointed here, which no amount of naming an address does by itself.
 */
export function EmailAddresses({
  organizationId,
  identities,
  domains,
  allowAdding = true,
}: {
  organizationId: string;
  identities: EmailIdentityView[];
  domains: { resourceId: string; domain: string; ready: boolean }[];
  /** Addresses are added in Email sending settings; the Inbox email page only switches receiving. */
  allowAdding?: boolean;
}) {
  return (
    <Section className="mt-8">
      <SectionHeading>Addresses</SectionHeading>
      <Hint className="mt-1">
        An address is named beneath a verified domain and can send once that domain is verified. Receiving is separate: turn it on
        only once the domain&apos;s mail records point at GildOps, otherwise nothing sent to the address will arrive.
      </Hint>

      {identities.length === 0 ? (
        <Hint className="mt-3">No address has been named yet.</Hint>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 font-medium">Address</th>
                <th className="py-2 pr-4 font-medium">Sending</th>
                <th className="py-2 font-medium">Receiving</th>
              </tr>
            </thead>
            <tbody>
              {identities.map((identity) => (
                <tr key={identity.id} className="border-b border-border align-top">
                  <td className="py-2 pr-4">
                    <div>{identity.address}</div>
                    {identity.displayName ? <div className="text-xs text-muted">{identity.displayName}</div> : null}
                  </td>
                  <td className="py-2 pr-4">
                    <div>{READINESS_LABEL[identity.readiness.state]}</div>
                    {identity.readiness.reason ? <div className="text-xs text-muted">{identity.readiness.reason}</div> : null}
                  </td>
                  <td className="py-2">
                    {identity.ownership === 'customer_domain' ? <ReceivingToggle organizationId={organizationId} identity={identity} /> : <span className="text-muted">Not available</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allowAdding ? <AddAddressForm organizationId={organizationId} domains={domains} /> : null}
    </Section>
  );
}
