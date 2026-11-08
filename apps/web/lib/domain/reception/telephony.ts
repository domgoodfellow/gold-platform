import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * The number one business dials from.
 *
 * **An identifier, never a credential**. The carrier account is GOLD's and the subaccount
 * under it is what keeps one business off another's number; what a business stores here grants
 * nothing on its own. A form that took a carrier auth token is the shape the provider-credential rule already refused for
 * payments — a real secret needing rotation and revocation — and it is refused here too.
 *
 * **Which half of the dialer this is.** `lib/adapters/telephony/` answers *can this deployment
 * place a call at all* — the account, the key, the application at the carrier — and stays an
 * environment question, because it is a fact about how this copy of the platform is wired. This
 * answers *what does this business ring from*, which is a fact about the business, and so it is a
 * row under RLS like everything else a business decides.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * Null when a business has not said. That is the ordinary state and not a fault: signing up does
 * not ask, and a platform that filled one in on a business's behalf would be answering through a
 * column — the reason `organizations.currency` is nullable too.
 */
export async function callingNumber(
  db: Db,
  input: { organizationId: string },
): Promise<string | null> {
  const { data, error } = await db
    .from('telephony_settings')
    .select('calling_number')
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error, 'telephony.read_failed');
  }

  return data?.calling_number ?? null;
}

/**
 * Set it, or clear it with an empty string.
 *
 * Clearing is a real act — a business taking its number down — and lands back on *cannot dial*
 * rather than on a stored empty string, which the check constraint would refuse anyway.
 */
export async function setCallingNumber(
  db: Db,
  input: { organizationId: string; number: string },
): Promise<void> {
  const number = input.number.trim();

  // Validated here for the sentence, enforced by the check constraint for the guarantee — the
  // database's own message for a failed regex is not one to put in front of somebody.
  if (number !== '' && !E164.test(number)) {
    throw new DomainError(
      'That is not a number this platform can dial from. It needs a country code, like +14165550142.',
      'telephony.number_invalid',
    );
  }

  const { error } = await db.rpc('set_calling_number', {
    p_organization_id: input.organizationId,
    p_number: number,
  });

  if (error) {
    throw new DomainError(
      // Refused by `telephony_settings_insert`/`_update`, which is where `organization.manage` is
      // actually enforced — the function is security invoker and adds no authority of its own.
      error.code === '42501'
        ? 'Your role cannot change the number this business dials from.'
        : error.message,
      'telephony.write_failed',
    );
  }
}
