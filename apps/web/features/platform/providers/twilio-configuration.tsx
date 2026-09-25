import { Badge, Detail, DefinitionList } from '@/components/display/data';
import { GroupHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { telephonyCredentialKinds } from '@/lib/adapters/telephony';
import type { ProviderAccount } from '@/lib/domain/providers/accounts';
import { AccountStatusControl, MakeDefaultButton, VerifyAccountButton } from './twilio-account-controls';
import { TwilioAccountForm } from './twilio-account-form';

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

/**
 * The one configuration surface for a GOLD-owned telephony account. The Configure drawer and the
 * full configuration route both render exactly this, so there is one set of fields, one set of
 * server actions and one set of validation — never a second settings implementation.
 *
 * Shows whether a credential exists and when it was set. It cannot show more: nothing in this
 * runtime can read one.
 */
export function TwilioConfiguration({ account }: { account?: ProviderAccount }) {
  const kinds = telephonyCredentialKinds();

  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <GroupHeading>Add a GildOps account</GroupHeading>
          <Hint>The parent account under which each organization’s own subaccount is created.</Hint>
        </div>
        <TwilioAccountForm kinds={kinds} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <GroupHeading>Account</GroupHeading>
        <TwilioAccountForm kinds={kinds} account={account} />
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading>Credential</GroupHeading>
        <DefinitionList>
          <Detail label="Stored">{account.credentialSetAt ? <Badge>Set</Badge> : <Badge>None</Badge>}</Detail>
          <Detail label="Last set or replaced">{when(account.credentialSetAt)}</Detail>
        </DefinitionList>
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading>Health</GroupHeading>
        <DefinitionList>
          <Detail label="Verification">{account.verificationState}</Detail>
          <Detail label="Last verified">{when(account.lastVerifiedAt)}</Detail>
          {account.verificationError ? <Detail label="Last error">{account.verificationError}</Detail> : null}
        </DefinitionList>
        {account.credentialSetAt ? <VerifyAccountButton accountId={account.id} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading>Provisioning</GroupHeading>
        <Hint>
          New organizations are provisioned under the default account. An organization stays under the
          account it began with.
        </Hint>
        {account.isDefault ? <Badge>Default account</Badge> : account.status === 'active' ? <MakeDefaultButton accountId={account.id} /> : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <GroupHeading>Danger zone</GroupHeading>
        <AccountStatusControl accountId={account.id} status={account.status} />
      </section>
    </div>
  );
}
