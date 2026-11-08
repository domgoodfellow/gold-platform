import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * An email address a business speaks as — `hello@acme.ca` — distinct from the sending domain it
 * sits beneath (`sending-domains.ts`) and from a mailbox.
 *
 * **Three words, three things.** A *sending domain* is the provider's permission for addresses
 * beneath a name. An *email identity* is one actual address this business uses. A *mailbox* is an
 * identity that can receive (`canReceive`) — which no customer-domain identity can claim here,
 * because nothing in this repository reads inbound mail. A sender is simply an identity with
 * `canSend`; nothing assumes every sender is a mailbox.
 *
 * **Readiness is derived, never stored.** The row holds a reference to what backs it and
 * `emailIdentityReadiness` reads that thing's own state, so there is one authority for "can this
 * domain send" — the provider resource — and an identity can never say verified while its domain
 * says failed.
 *
 * **A client names an identity by id and never supplies the `From` address.**
 * `resolveEmailSender` is the one place the address a message is sent as is decided, the email
 * counterpart of `resolveSmsSender`: it loads the identity inside the organization, checks it may
 * send and is ready, and returns the address. The email channel's send path calls it; nothing may
 * accept a `from` from a form.
 */

export type EmailOwnership = 'gildops_managed' | 'customer_domain' | 'connected_mailbox';

export type EmailIdentity = {
  id: string;
  address: string;
  displayName: string | null;
  canSend: boolean;
  canReceive: boolean;
  ownership: EmailOwnership;
  sendingDomainResourceId: string | null;
  integrationConnectionId: string | null;
  status: 'active' | 'disabled';
  createdAt: string;
};

export type EmailIdentityReadiness = {
  state: 'ready' | 'pending' | 'unavailable';
  /** A sentence a person can read when the state is not `ready`. */
  reason: string | null;
};

export type EmailIdentityView = EmailIdentity & { readiness: EmailIdentityReadiness };

/** The state of whatever backs an identity, as read from its own record. Null when nothing does. */
export type EmailIdentityBacking = {
  /** `organization_provider_resources.status` of the sending domain beneath a customer-domain address. */
  sendingDomainStatus: string | null;
  /** `integration_connections.status` of the connection behind a connected mailbox. */
  connectionStatus: string | null;
};

const READY: EmailIdentityReadiness = { state: 'ready', reason: null };

/**
 * One calculation of whether an address may be used, over the state of what backs it. Pure, so
 * every caller — a list, a send — reads the same answer from the same facts.
 */
export function emailIdentityReadiness(
  identity: Pick<EmailIdentity, 'ownership' | 'status' | 'canSend'>,
  backing: EmailIdentityBacking,
): EmailIdentityReadiness {
  if (identity.status === 'disabled') return { state: 'unavailable', reason: 'This address is switched off.' };

  switch (identity.ownership) {
    case 'customer_domain':
      if (backing.sendingDomainStatus === null) {
        return { state: 'unavailable', reason: 'The sending domain this address was on has been removed.' };
      }
      if (backing.sendingDomainStatus === 'active') return READY;
      if (backing.sendingDomainStatus === 'pending') return { state: 'pending', reason: 'The sending domain is not verified yet.' };
      return { state: 'unavailable', reason: 'The sending domain is not usable right now.' };

    case 'connected_mailbox':
      if (backing.connectionStatus === 'active') return READY;
      if (backing.connectionStatus === 'connecting') return { state: 'pending', reason: 'The mailbox connection is still being set up.' };
      return { state: 'unavailable', reason: 'The mailbox connection needs attention.' };

    case 'gildops_managed':
      // No managed domain exists to stand behind one, so no managed address can truthfully be ready.
      return { state: 'unavailable', reason: 'Managed addresses are not provisioned yet.' };
  }
}

const COLUMNS =
  'id, address, display_name, can_send, can_receive, ownership, sending_domain_resource_id, integration_connection_id, status, created_at';

type Row = {
  id: string;
  address: string;
  display_name: string | null;
  can_send: boolean;
  can_receive: boolean;
  ownership: string;
  sending_domain_resource_id: string | null;
  integration_connection_id: string | null;
  status: string;
  created_at: string;
};

function toIdentity(row: Row): EmailIdentity {
  return {
    id: row.id,
    address: row.address,
    displayName: row.display_name,
    canSend: row.can_send,
    canReceive: row.can_receive,
    ownership: row.ownership as EmailOwnership,
    sendingDomainResourceId: row.sending_domain_resource_id,
    integrationConnectionId: row.integration_connection_id,
    status: row.status as EmailIdentity['status'],
    createdAt: row.created_at,
  };
}

/** What backs each identity, read once for the set. RLS scopes both reads to the caller's organization. */
async function backingFor(db: Db, organizationId: string, identities: EmailIdentity[]): Promise<Map<string, EmailIdentityBacking>> {
  const resourceIds = [...new Set(identities.flatMap((i) => (i.sendingDomainResourceId ? [i.sendingDomainResourceId] : [])))];
  const connectionIds = [...new Set(identities.flatMap((i) => (i.integrationConnectionId ? [i.integrationConnectionId] : [])))];

  const resources = new Map<string, string>();
  if (resourceIds.length > 0) {
    const { data, error } = await db
      .from('organization_provider_resources')
      .select('id, status')
      .eq('organization_id', organizationId)
      .in('id', resourceIds);
    if (error) throw fromDatabaseError(error, 'email_identity.read_failed');
    for (const row of data ?? []) resources.set(row.id, row.status);
  }

  const connections = new Map<string, string>();
  if (connectionIds.length > 0) {
    const { data, error } = await db
      .from('integration_connections')
      .select('id, status')
      .eq('organization_id', organizationId)
      .in('id', connectionIds);
    if (error) throw fromDatabaseError(error, 'email_identity.read_failed');
    for (const row of data ?? []) connections.set(row.id, row.status);
  }

  return new Map(
    identities.map((identity) => [
      identity.id,
      {
        sendingDomainStatus: identity.sendingDomainResourceId ? (resources.get(identity.sendingDomainResourceId) ?? null) : null,
        connectionStatus: identity.integrationConnectionId ? (connections.get(identity.integrationConnectionId) ?? null) : null,
      },
    ]),
  );
}

export async function listEmailIdentities(db: Db, input: { organizationId: string }): Promise<EmailIdentityView[]> {
  const { data, error } = await db
    .from('email_identities')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('address');
  if (error) throw fromDatabaseError(error, 'email_identity.read_failed');

  const identities = (data ?? []).map(toIdentity);
  const backing = await backingFor(db, input.organizationId, identities);
  return identities.map((identity) => ({
    ...identity,
    readiness: emailIdentityReadiness(identity, backing.get(identity.id) ?? { sendingDomainStatus: null, connectionStatus: null }),
  }));
}

/**
 * Name an address beneath a sending domain this business already holds. Nothing here asks the
 * provider anything: whether the address is usable is the domain's own state, read later.
 */
export async function createEmailIdentity(
  db: Db,
  input: { organizationId: string; address: string; displayName?: string | null; sendingDomainResourceId: string },
): Promise<EmailIdentity> {
  const actor = await requireActor(db);
  const address = input.address.trim().toLowerCase();
  if (!address.includes('@')) throw new DomainError('An email address needs an @, like hello@acme.ca.', 'email_identity.invalid');

  const { data, error } = await db
    .from('email_identities')
    .insert({
      organization_id: input.organizationId,
      address,
      display_name: input.displayName?.trim() || null,
      ownership: 'customer_domain',
      sending_domain_resource_id: input.sendingDomainResourceId,
      created_by: actor.id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === '42501') throw new DomainError('Your role cannot add email addresses for this business.', 'email_identity.forbidden');
    if (error.code === '23505') throw new DomainError('This business already has that address.', 'email_identity.duplicate');
    if (error.code === '23514' || error.code === '23503') throw fromDatabaseError(error, 'email_identity.invalid');
    throw fromDatabaseError(error, 'email_identity.write_failed');
  }
  return toIdentity(data);
}

/**
 * The address a message is sent as, decided here from a tenant-scoped identity. Refused when the
 * identity is not this business's (RLS makes it absent), cannot send, or is not ready — the three
 * things a browser-supplied `From` would have skipped.
 */
export async function resolveEmailSender(
  db: Db,
  input: { organizationId: string; emailIdentityId: string },
): Promise<{ emailIdentityId: string; address: string; displayName: string | null }> {
  const { data, error } = await db
    .from('email_identities')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.emailIdentityId)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'email_identity.read_failed');
  if (!data) throw new DomainError('That address does not belong to this business.', 'email_identity.not_found');

  const identity = toIdentity(data);
  if (!identity.canSend) throw new DomainError('That address cannot send email.', 'email_identity.not_sender');

  const backing = (await backingFor(db, input.organizationId, [identity])).get(identity.id)!;
  const readiness = emailIdentityReadiness(identity, backing);
  if (readiness.state !== 'ready') {
    throw new DomainError(readiness.reason ?? 'That address is not ready to send email.', 'email_identity.not_ready');
  }

  return { emailIdentityId: identity.id, address: identity.address, displayName: identity.displayName };
}

/**
 * A business stating that mail for one of its addresses is pointed here (or no longer is). This does
 * not make the address receive anything: nothing arrives unless the domain's own mail records say so,
 * which is provisioning and not done here. What it records is the business's statement, and an inbound
 * message is accepted only for an address that makes it, that is active, and that sits beneath a
 * verified domain.
 */
export async function setEmailIdentityReceiving(
  db: Db,
  input: { organizationId: string; emailIdentityId: string; canReceive: boolean },
): Promise<void> {
  const { data, error } = await db
    .from('email_identities')
    .update({ can_receive: input.canReceive })
    .eq('organization_id', input.organizationId)
    .eq('id', input.emailIdentityId)
    .select('id');
  if (error) throw fromDatabaseError(error, 'email_identity.write_failed');
  // RLS answers "not yours" and "your role cannot" with the same empty result.
  if (!data || data.length === 0) throw new DomainError('Your role cannot change this address.', 'email_identity.forbidden');
}
