import { Badge, Detail, DefinitionList } from '@/components/display/data';
import { GroupHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import type { ProviderAccount } from '@/lib/domain/providers/accounts';
import {
  MakeProviderAccountDefaultButton,
  ProviderAccountStatusControl,
  VerifyProviderAccountButton,
} from './provider-account-controls';
import { ProviderAccountForm } from './provider-account-form';

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

/**
 * The one configuration surface for a GOLD-owned API-key account — the generic counterpart to
 * `TwilioConfiguration` for a Provider with no subaccount, resource or per-organization binding
 * model (openai, anthropic, google today). The Configure drawer and the full configuration route
 * both render exactly this, for the same reason Twilio's does: one set of fields, one set of
 * server actions, never a second settings implementation.
 *
 * No "Provisioning" section: nothing here is provisioned per organization. GOLD holds one account
 * and every assignment naming it answers from it directly (`app.ai.runtime`).
 */
export function ProviderConfiguration({ providerKey, account }: { providerKey: string; account?: ProviderAccount }) {
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <GroupHeading>Add a GOLD account</GroupHeading>
          <Hint>The credential GOLD uses to answer through this provider.</Hint>
        </div>
        <ProviderAccountForm providerKey={providerKey} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <GroupHeading>Account</GroupHeading>
        <ProviderAccountForm providerKey={providerKey} account={account} />
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading>Credential</GroupHeading>
        <DefinitionList>
          <Detail label="Stored">{account.credentialSetAt ? <Badge>Set</Badge> : <Badge>None</Badge>}</Detail>
          <Detail label="Last set or replaced">{when(account.credentialSetAt)}</Detail>
        </DefinitionList>
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading>Verification</GroupHeading>
        <DefinitionList>
          <Detail label="State">{account.verificationState}</Detail>
          <Detail label="Last checked">{when(account.lastVerifiedAt)}</Detail>
          {account.verificationError ? <Detail label="Last error">{account.verificationError}</Detail> : null}
        </DefinitionList>
        {account.credentialSetAt ? <VerifyProviderAccountButton accountId={account.id} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <GroupHeading>Default</GroupHeading>
        <Hint>The account an AI runtime assignment uses when more than one exists for this provider.</Hint>
        {account.isDefault ? (
          <Badge>Default account</Badge>
        ) : account.status === 'active' ? (
          <MakeProviderAccountDefaultButton accountId={account.id} />
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <GroupHeading>Danger zone</GroupHeading>
        <ProviderAccountStatusControl accountId={account.id} status={account.status} />
      </section>
    </div>
  );
}
