import type { ProviderAccount } from './accounts';

/**
 * Whether a provider can be relied on right now, in the operator's terms.
 *
 * **Three answers and the reason for each**, because "not working" with no reason is the state
 * this control plane exists to remove. Pure: the caller reads the environment and the database
 * and hands over facts, so every combination is a plain test.
 *
 * A deployment-level credential (the bootstrap) still counts as ready — every binding made before
 * accounts existed depends on it — but it is reported as what it is, so an operator can see the
 * account they configured is not the one in use.
 */
export type ProviderReadiness = {
  state: 'operational' | 'attention' | 'not_configured';
  summary: string;
  reasons: string[];
};

export function providerReadiness(input: {
  accounts: ProviderAccount[];
  bootstrapConfigured: boolean;
  /** Whether `apps/api` is reachable from here — an account's credential can only be used through it. */
  apiConfigured: boolean;
}): ProviderReadiness {
  const fallback = input.bootstrapConfigured ? ['This deployment’s own credential is configured and is what existing scopes use.'] : [];
  const active = input.accounts.filter((account) => account.status === 'active');
  const preferred = active.find((account) => account.isDefault) ?? active[0];

  if (!preferred) {
    return input.bootstrapConfigured
      ? {
          state: 'operational',
          summary: 'Running on the deployment’s own credential',
          reasons: ['No GildOps account is recorded here yet.', ...fallback],
        }
      : { state: 'not_configured', summary: 'Not configured', reasons: ['No GildOps account is recorded and this deployment holds no credential.'] };
  }

  const reasons: string[] = [];
  if (!preferred.credentialSetAt) reasons.push(`${preferred.label} has no credential stored.`);
  if (preferred.verificationState === 'failed') reasons.push(`${preferred.label} failed verification: ${preferred.verificationError ?? 'no reason given'}.`);
  if (preferred.verificationState === 'unverified' && preferred.credentialSetAt) reasons.push(`${preferred.label} has not been verified.`);
  if (!input.apiConfigured) reasons.push('This deployment cannot reach the API that uses account credentials.');

  if (reasons.length === 0) {
    return { state: 'operational', summary: `Operational through ${preferred.label}`, reasons: [] };
  }
  return { state: 'attention', summary: 'Needs attention', reasons: [...reasons, ...fallback] };
}
