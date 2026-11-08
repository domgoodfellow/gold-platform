import type { ConnectedAccount } from '@/lib/adapters/payments';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The processor account a business connected. What's stored is an account id, not a credential
 * — it grants nothing alone, and the business can revoke it from their own dashboard.
 * The money never reaches GOLD: the charge is created directly on this account, which is what
 * keeps this off the money-transmitter shape the provider-credential rule refuses.
 */

export type PaymentAccount = {
  /** The domain layer never branches on this. */
  provider: string;
  account: ConnectedAccount;
  connectedAt: string;
};

export async function getPaymentAccount(
  db: Db,
  input: { organizationId: string; provider: string },
): Promise<PaymentAccount | null> {
  const { data, error } = await db
    .from('payment_accounts')
    .select('provider, account_id, connected_at')
    .eq('organization_id', input.organizationId)
    .eq('provider', input.provider)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error, 'payment_accounts.read_failed');
  }
  if (!data) return null;

  return {
    provider: data.provider,
    account: { accountId: data.account_id },
    connectedAt: data.connected_at,
  };
}

/**
 * Record that a business has connected an account. Called only by the callback route, after the
 * provider confirms — the account id never comes from an operator-typed form, or anyone could
 * point another business's payments at an account of their choosing. Reconnecting replaces
 * (delete then insert) because the table has no update policy — a row re-pointed in place would
 * move a business's money with nothing recording that it moved.
 */
export async function connectPaymentAccount(
  db: Db,
  input: { organizationId: string; provider: string; account: ConnectedAccount },
): Promise<void> {
  const actor = await requireActor(db);

  const accountId = input.account.accountId.trim();
  if (accountId.length === 0) {
    throw new DomainError(
      'The payment service did not name an account.',
      'payment_accounts.account_missing',
    );
  }

  await db
    .from('payment_accounts')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('provider', input.provider);

  const { error } = await db.from('payment_accounts').insert({
    organization_id: input.organizationId,
    provider: input.provider,
    account_id: accountId,
    connected_by: actor.id,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'Your role cannot decide where this business is paid.',
        'payment_accounts.forbidden',
      );
    }
    throw fromDatabaseError(error, 'payment_accounts.connect_failed');
  }
}

/**
 * Stop using an account. Removes nothing already recorded — past payments stay attached to the
 * invoices they settled. Doesn't revoke the authorization at the provider; the business
 * does that from their own dashboard.
 */
export async function disconnectPaymentAccount(
  db: Db,
  input: { organizationId: string; provider: string },
): Promise<void> {
  await requireActor(db);

  // A refused RLS delete matches nothing and reports success — so the returned rows are the only
  // way to tell "you may not" from "there was nothing to remove".
  const { data, error } = await db
    .from('payment_accounts')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('provider', input.provider)
    .select('provider');

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'Your role cannot decide where this business is paid.',
        'payment_accounts.forbidden',
      );
    }
    throw fromDatabaseError(error, 'payment_accounts.disconnect_failed');
  }

  if ((data ?? []).length === 0) {
    const remaining = await getPaymentAccount(db, {
      organizationId: input.organizationId,
      provider: input.provider,
    });
    // Still there after a delete that reported success: the policy refused it.
    if (remaining) {
      throw new DomainError(
        'Your role cannot decide where this business is paid.',
        'payment_accounts.forbidden',
      );
    }
    // Nothing was connected. Disconnecting nothing is not a failure.
  }
}
