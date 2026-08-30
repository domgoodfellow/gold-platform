import type { ConnectedAccount } from '@/lib/adapters/payments';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The processor account a business connected.
 *
 * **What is stored is an account id, not a credential** (D27). It grants nothing on its own,
 * it is worthless without the platform's own key, and the business can revoke it from their own
 * processor dashboard without telling us — so it is per-tenant configuration like a currency,
 * and there is no vault here because there is nothing a vault would be for.
 *
 * **The money never reaches GOLD.** The charge is created on this account, so funds go straight
 * to the business. A platform that collects and pays out is a money transmitter in most
 * jurisdictions, and the thing that decides it is the charge type rather than the word
 * "platform" — see D27, and the `Stripe-Account` header in the adapter, which is where the
 * decision physically is.
 */

export type PaymentAccount = {
  /** Which processor. The domain layer never branches on it (I15). */
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
    throw new DomainError(error.message, 'payment_accounts.read_failed');
  }
  if (!data) return null;

  return {
    provider: data.provider,
    account: { accountId: data.account_id },
    connectedAt: data.connected_at,
  };
}

/**
 * Record that a business has connected an account.
 *
 * **Called only by the callback route, after the provider has confirmed the authorization.**
 * The account id is not something an operator types: it comes back from the exchange, which is
 * authenticated with the platform's own key. A form that accepted one would let somebody point
 * another business's payments at an account of their choosing.
 *
 * Reconnecting replaces: the delete and the insert are both here, because the table has no
 * update policy on purpose — a row that could be re-pointed in place would move a business's
 * money with nothing recording that it moved.
 */
export async function connectPaymentAccount(
  db: Db,
  input: { organizationId: string; provider: string; account: ConnectedAccount },
): Promise<void> {
  const actor = await requireActor(db);

  const accountId = input.account.accountId.trim();
  if (accountId.length === 0) {
    throw new DomainError(
      'The payment provider did not name an account.',
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
    throw new DomainError(error.message, 'payment_accounts.connect_failed');
  }
}

/**
 * Stop using an account.
 *
 * **This removes nothing that has already happened.** Payments recorded against it stay, in the
 * currency they were taken in, attached to the invoices they settled — the same reasoning I8
 * gives about configuration never reaching backwards. What stops is new charges.
 *
 * It does not revoke the authorization at the provider; the business does that from their own
 * dashboard, which is the point of them holding it rather than us.
 */
export async function disconnectPaymentAccount(
  db: Db,
  input: { organizationId: string; provider: string },
): Promise<void> {
  await requireActor(db);

  // **A refused delete is not an error, and that is the trap this handles.** An RLS `delete`
  // whose policy excludes the row matches nothing and returns success — so a role without
  // `organization.manage` was being told the account was disconnected while it sat there. The
  // returned rows are the only way to tell "you may not" from "there was nothing to remove",
  // and reporting a write that did not happen is worse than refusing one that could not.
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
    throw new DomainError(error.message, 'payment_accounts.disconnect_failed');
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
