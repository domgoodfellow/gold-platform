import type { ProviderAccount } from './accounts';
import type { ProviderService } from './services';

/**
 * How far along a Provider is, as six separate facts — never one flag standing in for all of them.
 *
 *   catalogued             a row exists (always true here: this is read from the catalogue)
 *   account configurable   an adapter exists that can *use* an account for this provider
 *   credential configured  an active account holds a credential, and what verifying it said
 *   service implemented    GildOps runs at least one of the services catalogued for it
 *   runtime assigned       an AI capability is answered by it — only where it offers one
 *   operational            every applicable one of the above, at once
 *
 * A provider row existing says nothing about the rest: `elevenlabs` is catalogued and has none of
 * them, and the screen must say so rather than draw an *Add account* control nothing could use.
 * Pure — the caller reads the database and the deployment and hands over facts, so every
 * combination is a plain test.
 */

export type ProviderCredentialState = 'none' | 'stored' | 'verified' | 'failed' | 'deployment';

export type ProviderStages = {
  accountAdapter: boolean;
  credential: ProviderCredentialState;
  implemented: { available: number; catalogued: number };
  runtime: { applicable: boolean; assigned: number };
  operational: boolean;
  /** The first missing fact, in words an operator can act on; `null` when operational. */
  blocker: string | null;
};

export function providerStages(input: {
  /** An adapter exists that can use an account for this provider. */
  accountAdapter: boolean;
  accounts: readonly Pick<ProviderAccount, 'status' | 'credentialSetAt' | 'verificationState'>[];
  services: readonly Pick<ProviderService, 'kind' | 'implementationState'>[];
  /** AI capabilities currently assigned to this provider. */
  runtimeAssignments: number;
  /** The deployment's own credential answers for this provider (a bootstrap fallback). */
  deploymentCredential?: boolean;
}): ProviderStages {
  const active = input.accounts.filter((account) => account.status === 'active');
  const credential: ProviderCredentialState = active.some((a) => a.credentialSetAt && a.verificationState === 'verified')
    ? 'verified'
    : active.some((a) => a.credentialSetAt && a.verificationState === 'failed')
      ? 'failed'
      : active.some((a) => a.credentialSetAt)
        ? 'stored'
        : input.deploymentCredential
          ? 'deployment'
          : 'none';

  const available = input.services.filter((service) => service.implementationState === 'available').length;
  const runtimeApplicable = input.services.some((service) => service.kind === 'runtime' && service.implementationState === 'available');

  const blocker = !input.accountAdapter
    ? 'No account adapter'
    : credential === 'none'
      ? 'No credential stored'
      : credential === 'failed'
        ? 'Credential failed verification'
        : credential === 'stored'
          ? 'Credential not verified'
          : available === 0
            ? 'No service implemented'
            : runtimeApplicable && input.runtimeAssignments === 0
              ? 'Not assigned to an AI job'
              : null;

  return {
    accountAdapter: input.accountAdapter,
    credential,
    implemented: { available, catalogued: input.services.length },
    runtime: { applicable: runtimeApplicable, assigned: input.runtimeAssignments },
    operational: blocker === null,
    blocker,
  };
}

export const CREDENTIAL_LABEL: Record<ProviderCredentialState, string> = {
  none: 'None stored',
  stored: 'Stored, not verified',
  verified: 'Verified',
  failed: 'Failed verification',
  deployment: 'GildOps’ own credential',
};
