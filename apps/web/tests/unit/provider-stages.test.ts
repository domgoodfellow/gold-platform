import { describe, expect, it } from 'vitest';
import { providerStages } from '@/lib/domain/providers/stages';

const verified = { status: 'active' as const, credentialSetAt: '2026-01-01', verificationState: 'verified' as const };
const runtimeService = { kind: 'runtime' as const, implementationState: 'available' as const };
const plannedService = { kind: 'runtime' as const, implementationState: 'planned' as const };

describe('how far along a provider is', () => {
  it('says a catalogued provider with no adapter, account or service is none of the rest', () => {
    const stages = providerStages({ accountAdapter: false, accounts: [], services: [], runtimeAssignments: 0 });
    expect(stages).toMatchObject({ accountAdapter: false, credential: 'none', operational: false, blocker: 'No account adapter' });
    expect(stages.implemented).toEqual({ available: 0, catalogued: 0 });
  });

  it('is not operational merely because a credential is stored: it has to have been verified', () => {
    const stored = providerStages({
      accountAdapter: true, accounts: [{ ...verified, verificationState: 'unverified' }], services: [runtimeService], runtimeAssignments: 1,
    });
    expect(stored).toMatchObject({ credential: 'stored', operational: false, blocker: 'Credential not verified' });
  });

  it('names a credential that failed verification', () => {
    const failed = providerStages({
      accountAdapter: true, accounts: [{ ...verified, verificationState: 'failed' }], services: [runtimeService], runtimeAssignments: 1,
    });
    expect(failed.blocker).toBe('Credential failed verification');
  });

  it('is not operational with a verified account and only planned services', () => {
    const planned = providerStages({ accountAdapter: true, accounts: [verified], services: [plannedService], runtimeAssignments: 0 });
    expect(planned).toMatchObject({ credential: 'verified', operational: false, blocker: 'No service implemented' });
  });

  it('needs an assignment only where the provider offers an AI runtime', () => {
    const unassigned = providerStages({ accountAdapter: true, accounts: [verified], services: [runtimeService], runtimeAssignments: 0 });
    expect(unassigned).toMatchObject({ operational: false, blocker: 'Not assigned to an AI job', runtime: { applicable: true, assigned: 0 } });

    const infrastructure = providerStages({
      accountAdapter: true, accounts: [verified], services: [{ kind: 'infrastructure', implementationState: 'available' }], runtimeAssignments: 0,
    });
    expect(infrastructure).toMatchObject({ operational: true, blocker: null, runtime: { applicable: false } });
  });

  it('is operational when every applicable fact holds', () => {
    const ready = providerStages({ accountAdapter: true, accounts: [verified], services: [runtimeService, plannedService], runtimeAssignments: 2 });
    expect(ready).toMatchObject({ operational: true, blocker: null, implemented: { available: 1, catalogued: 2 } });
  });

  it('counts a deployment credential as configured, and a disabled account as nothing', () => {
    expect(providerStages({ accountAdapter: true, accounts: [], services: [{ kind: 'infrastructure', implementationState: 'available' }], runtimeAssignments: 0, deploymentCredential: true }))
      .toMatchObject({ credential: 'deployment', operational: true });
    expect(providerStages({ accountAdapter: true, accounts: [{ ...verified, status: 'disabled' as never }], services: [], runtimeAssignments: 0 }).credential).toBe('none');
  });
});
