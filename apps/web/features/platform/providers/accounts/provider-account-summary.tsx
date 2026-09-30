import { Section, SectionHeading } from '@/components/surfaces/section';
import { Badge, Detail, DefinitionList } from '@/components/display/data';
import type { ProviderAccount } from '@/lib/domain/providers/accounts';

const VERIFICATION_TONE: Record<ProviderAccount['verificationState'], 'success' | 'danger' | 'neutral'> = {
  verified: 'success',
  failed: 'danger',
  unverified: 'neutral',
};

/**
 * The read-only fact a Provider's Overview shows about its account — never the form. Editing
 * happens in the Configure drawer (`ProviderConfiguration`), which this links to only through the
 * page's own `PageHeader configure` trigger; this component holds no action of its own.
 */
export function ProviderAccountSummary({ account }: { account: ProviderAccount | null }) {
  return (
    <Section>
      <SectionHeading>Account</SectionHeading>
      {account ? (
        <DefinitionList>
          <Detail label="Label">{account.label}</Detail>
          <Detail label="Credential">{account.credentialSetAt ? <Badge>Set</Badge> : <Badge tone="neutral">Not configured</Badge>}</Detail>
          <Detail label="Verification">
            <Badge tone={VERIFICATION_TONE[account.verificationState]}>{account.verificationState}</Badge>
          </Detail>
          <Detail label="Status">
            <Badge tone={account.status === 'active' ? 'success' : 'neutral'}>{account.status}</Badge>
          </Detail>
        </DefinitionList>
      ) : (
        <p className="mt-2 text-sm text-muted">Not configured. Use Configure to add a GildOps account.</p>
      )}
    </Section>
  );
}
