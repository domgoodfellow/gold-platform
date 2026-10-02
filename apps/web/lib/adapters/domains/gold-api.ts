import { callDomainCommand } from '@/lib/api/client';
import type { DnsAutomation, DnsRecord, DomainProvider, DomainStanding } from './index';

type Answer = {
  domain_id: string;
  hostname: string;
  configuration_state: DomainStanding['configurationState'];
  verification_state: DomainStanding['verificationState'];
  ssl_state: DomainStanding['certificateState'];
  dns_records: DnsRecord[];
  dns_automation?: { available: boolean; connectionId: string | null; zoneName: string | null };
};

function standing(answer: Answer): DomainStanding {
  return {
    domainId: answer.domain_id,
    hostname: answer.hostname,
    configurationState: answer.configuration_state,
    verificationState: answer.verification_state,
    certificateState: answer.ssl_state,
    dnsRecords: answer.dns_records ?? [],
    dnsAutomation: toAutomation(answer.dns_automation),
  };
}

function toAutomation(raw: Answer['dns_automation']): DnsAutomation {
  return { available: raw?.available ?? false, connectionId: raw?.connectionId ?? null, zoneName: raw?.zoneName ?? null };
}

/**
 * A custom domain, addressed through `apps/api`'s `/organizations/domains`.
 *
 * **No credential is here and none can be** — the same reasoning as `twilio-accounts.ts`. Each
 * method is one command carrying the person's own token; `apps/api` proves they may manage the
 * business's domains, reads GildOps' hosting credential and talks to the provider. This file only
 * translates that command's JSON into the capability's types.
 */
export function goldApiDomainProvider(input: { token: string }): DomainProvider {
  function run<T>(command: 'connect' | 'check' | 'remove' | 'apply_dns', target: { organizationId: string; domainId: string }): Promise<T> {
    return callDomainCommand<T>('/organizations/domains', {
      token: input.token,
      body: { command, organization_id: target.organizationId, domain_id: target.domainId },
    });
  }

  return {
    connect: async (target) => standing(await run<Answer>('connect', target)),
    check: async (target) => standing(await run<Answer>('check', target)),
    applyAutomation: async (target) => standing(await run<Answer>('apply_dns', target)),
    remove: async (target) => {
      await run('remove', target);
    },
  };
}
