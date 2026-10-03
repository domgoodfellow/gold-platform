import { callDomainCommand } from '@/lib/api/client';
import type {
  DnsApplyOutcome,
  DnsAutomation,
  RequiredDnsRecord,
  SendingDomainProvider,
  SendingDomainStanding,
} from './index';

type Answer = {
  resource_id: string;
  domain: string;
  /** `apps/api` speaks the resource's own lifecycle word; `ready` is this capability's. */
  state: 'pending' | 'active' | 'failed';
  provider_status: string;
  records: RequiredDnsRecord[];
  records_verified: number;
  dns_automation?: { available: boolean; connectionId: string | null; zoneName: string | null };
  dns_outcome?: { applied: boolean; zoneName: string | null; records: DnsApplyOutcome['records'] } | null;
};

function automation(raw: Answer['dns_automation']): DnsAutomation {
  return { available: raw?.available ?? false, connectionId: raw?.connectionId ?? null, zoneName: raw?.zoneName ?? null };
}

function outcome(raw: Answer['dns_outcome']): DnsApplyOutcome | null {
  if (!raw) return null;
  return { applied: raw.applied, zoneName: raw.zoneName, records: raw.records ?? [] };
}

function standing(answer: Answer): SendingDomainStanding {
  return {
    resourceId: answer.resource_id,
    domain: answer.domain,
    state: answer.state === 'active' ? 'ready' : answer.state === 'failed' ? 'failed' : 'pending',
    providerStatus: answer.provider_status,
    records: answer.records ?? [],
    recordsVerified: answer.records_verified ?? 0,
    dnsAutomation: automation(answer.dns_automation),
    dnsOutcome: outcome(answer.dns_outcome),
  };
}

/**
 * A sending domain, addressed through `apps/api`'s `/organizations/email-domains`.
 *
 * **No credential is here and none can be** — the same reasoning `gold-api.ts` gives for custom
 * domains. Each method is one command carrying the person's own token; `apps/api` proves they may
 * manage this business's email, reads GildOps' provider credential and talks to the provider. This
 * file only translates that command's JSON into the capability's types.
 */
export function goldApiSendingDomainProvider(input: { token: string }): SendingDomainProvider {
  function run<T>(
    command: 'provision' | 'check' | 'apply_dns' | 'release',
    target: { organizationId: string; resourceId: string },
  ): Promise<T> {
    return callDomainCommand<T>('/organizations/email-domains', {
      token: input.token,
      body: { command, organization_id: target.organizationId, resource_id: target.resourceId },
    });
  }

  return {
    provision: async (target) => standing(await run<Answer>('provision', target)),
    check: async (target) => standing(await run<Answer>('check', target)),
    applyDns: async (target) => standing(await run<Answer>('apply_dns', target)),
    release: async (target) => {
      await run('release', target);
    },
  };
}
