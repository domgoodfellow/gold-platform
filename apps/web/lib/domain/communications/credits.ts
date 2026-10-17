import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * What a business has left to spend on reaching people, and what it has spent.
 *
 * **The communications engine's one shared piece.** A telephone call, a text message and an
 * email are three acts with three adapters and three records, and none of that belongs here.
 * What they share is that each costs money, the money is the same money, and a business that has
 * run out must be stopped *before* the spend rather than invoiced after it.
 *
 * **Bought in advance, which is what keeps this out of being a utility bill.** Nobody can spend
 * what they have not already handed over: no arrears, no dunning, no credit risk, and no invoice
 * at the end of a month. A pack of credit is a thing purchased, like an implementation — which
 * is why it is sold as a purchase, not billed as usage.
 *
 * **Nothing here can add credit**, and that is deliberate rather than unfinished. No policy on
 * `organization_credits` permits an insert by anybody signed in, so a member topping up their
 * own purse is impossible rather than merely ungranted. Money in arrives from a payment, through
 * a machine role, and that is the next slice.
 */

/**
 * The meters that reaching somebody is measured in. A voice minute, a text segment and an email
 * are three meters of the one economics model; this file knows which meter is which and owns no
 * price, no rate table and no arithmetic about either.
 */
export const COMMUNICATION_METERS = ['voice_minutes', 'sms_segment', 'email_send'] as const;

export type CommunicationMeter = (typeof COMMUNICATION_METERS)[number];

/** Wording for the one screen that renders a statement. Describes the platform, not a tenant. */
export const COMMUNICATION_METER_LABELS: Record<CommunicationMeter, string> = {
  voice_minutes: 'Calls',
  sms_segment: 'Text messages',
  email_send: 'Email',
};

export type Rate = {
  meterId: CommunicationMeter;
  currency: string;
  /** What one unit costs, in micro-minor units of the currency. */
  unitAmountMicros: number;
};

function isCommunicationMeter(value: string): value is CommunicationMeter {
  return (COMMUNICATION_METERS as readonly string[]).includes(value);
}

/**
 * What is left, in minor units.
 *
 * **One answer, and it is a sum rather than a column**. Credit bought, less every charge on
 * a usage event, in the business's own currency; there is no balance field anywhere in the
 * schema, for the same reason there is no stored invoice total.
 */
export async function creditBalance(
  db: Db,
  input: { organizationId: string },
): Promise<number> {
  const { data, error } = await db.rpc('credit_balance', {
    p_organization_id: input.organizationId,
  });

  if (error) {
    throw new DomainError(error.message, 'credits.balance_failed');
  }

  return Number(data ?? 0);
}

/**
 * What this deployment charges for reaching people, in a business's own currency.
 *
 * **The database resolves the rate** (`effective_retail_rates`), the same resolution a usage
 * event is priced with; this only picks the meters that are communications.
 *
 * **Empty is a complete answer and the most common one.** A deployment that has priced nothing
 * charges nothing and draws nothing down, which is what makes credit opt-in rather than a thing
 * that stops every existing tenant working on the day it ships.
 */
export async function listRates(
  db: Db,
  input: { organizationId: string; currency: string | null },
): Promise<Rate[]> {
  if (!input.currency) return [];

  const { data, error } = await db.rpc('effective_retail_rates', {
    p_currency: input.currency,
    p_organization_id: input.organizationId,
  });

  if (error) {
    throw new DomainError(error.message, 'credits.rates_failed');
  }

  return (data ?? []).flatMap((row) =>
    isCommunicationMeter(row.meter_id)
      ? [
          {
            meterId: row.meter_id,
            currency: row.currency,
            unitAmountMicros: Number(row.unit_amount_micros),
          },
        ]
      : [],
  );
}

/**
 * Everything the settings screen needs to say about money for reaching people.
 *
 * One call rather than two, because the two questions are only meaningful together: a balance
 * with no rate beside it does not say how long it lasts, and a rate with no balance does not say
 * whether anything can be spent.
 */
export async function communicationsAccount(
  db: Db,
  input: { organizationId: string; currency: string | null },
): Promise<{ balanceMinor: number; rates: Rate[]; priced: boolean }> {
  const [balanceMinor, rates] = await Promise.all([
    creditBalance(db, input),
    listRates(db, { organizationId: input.organizationId, currency: input.currency }),
  ]);

  return { balanceMinor, rates, priced: rates.length > 0 };
}
