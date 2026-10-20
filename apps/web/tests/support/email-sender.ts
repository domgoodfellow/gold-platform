import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { Db } from '@/lib/db/types';
import { createEmailIdentity } from '@/lib/domain/email/identities';

export type ReadySender = { identityId: string; domainId: string; bindingId: string; accountId: string; address: string };

/**
 * A verified sending address for a disposable local business, made the way a business makes one —
 * its owner names the domain and the address — with the two facts only the platform can supply
 * written directly: a fixture provider account holding the domain, and the domain's verification.
 * Local database only; the account's key is a placeholder and nothing is ever sent with it.
 */
export async function readyEmailSender(pg: Client, owner: Db, organizationId: string, options: { makeDefault?: boolean } = {}): Promise<ReadySender> {
  const domainName = `send-${randomUUID().slice(0, 8)}.example.test`;
  const named = await owner.rpc('record_organization_email_domain', { p_organization_id: organizationId, p_domain: domainName });
  if (named.error) throw named.error;
  const domainId = named.data as string;
  const address = `hello@${domainName}`;
  const identityId = (await createEmailIdentity(owner, { organizationId, address, sendingDomainResourceId: domainId })).id;
  // A business has one binding per provider, shared by all its domains: the account that confirms
  // the first domain is recorded on it, and every later domain is confirmed through the same one.
  const bindingId = (await pg.query('select binding_id from organization_provider_resources where organization_id=$1 and id=$2', [organizationId, domainId])).rows[0].binding_id as string;
  let accountId = (await pg.query('select provider_account_id from organization_provider_bindings where id=$1', [bindingId])).rows[0].provider_account_id as string | null;
  accountId ??= (await pg.query("insert into platform_provider_accounts(provider_key,label,credential_kind,credential_identifier,credential_set_at) values('resend',$1,'api_key','fixture-key',now()) returning id", [`Fixture sender ${randomUUID().slice(0, 8)}`])).rows[0].id as string;
  // As domain setup records it once the provider has answered for the domain under that account.
  await pg.query("select record_email_domain_provisioning($1,$2,'active',p_provider_account_id=>$3)", [organizationId, domainId, accountId]);
  if (options.makeDefault ?? true) {
    const set = await owner.rpc('set_default_email_sender', { p_organization_id: organizationId, p_email_identity_id: identityId });
    if (set.error) throw set.error;
  }
  return { identityId, domainId, bindingId, accountId, address };
}
