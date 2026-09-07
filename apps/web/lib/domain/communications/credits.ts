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
 * is why `market.md` needed one row corrected rather than its position rewritten.
 *
 * **Nothing here can add credit**, and that is deliberate rather than unfinished. No policy on
 * `communication_credits` permits an insert by anybody signed in, so a member topping up their
 * own purse is impossible rather than merely ungranted. Money in arrives from a payment, through
 * a machine role, and that is the next slice.
 */

export const CHANNELS = ['voice', 'sms', 'email'] as const;

export type Channel = (typeof CHANNELS)[number];

/** Wording for the one screen that renders a statement. Describes the platform, not a tenant. */
export const CHANNEL_LABELS: Record<Channel, string> = {
  voice: 'Calls',
  sms: 'Text messages',
  email: 'Email',
};

export type CreditEntry = {
  id: string;
  /** Positive is money in, negative is money spent. Minor units of this business's currency. */
  amountMinor: number;
  currency: string;
  reason: 'purchase' | 'usage' | 'adjustment';
  channel: Channel | null;
  note: string;
  occurredAt: string;
};

export type Rate = {
  channel: Channel;
  currency: string;
  /** What one unit costs: a minute of voice, one message otherwise. */
  unitAmountMinor: number;
};

function isChannel(value: string | null): value is Channel {
  return value !== null && (CHANNELS as readonly string[]).includes(value);
}

/**
 * What is left, in minor units.
 *
 * **One answer, and it is a sum rather than a column** (I4). There is no balance field anywhere
 * in the schema, for the same reason there is no stored invoice total: two places holding one
 * number disagree eventually, and then the answer is whichever was written last.
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

/** The statement: what moved, newest first. */
export async function listCreditEntries(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<CreditEntry[]> {
  const { data, error } = await db
    .from('communication_credits')
    .select('id, amount_minor, currency, reason, channel, note, occurred_at')
    .eq('organization_id', input.organizationId)
    .order('occurred_at', { ascending: false })
    .limit(input.limit ?? 100);

  if (error) {
    throw new DomainError(error.message, 'credits.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    reason: row.reason as CreditEntry['reason'],
    channel: isChannel(row.channel) ? row.channel : null,
    note: row.note,
    occurredAt: row.occurred_at,
  }));
}

/**
 * What this deployment charges, in a business's own currency.
 *
 * **Empty is a complete answer and the most common one.** A deployment that has priced nothing
 * charges nothing and draws nothing down, which is what makes credit opt-in rather than a thing
 * that stops every existing tenant working on the day it ships. The screen says so rather than
 * showing a balance nobody is spending.
 */
export async function listRates(
  db: Db,
  input: { currency: string | null },
): Promise<Rate[]> {
  if (!input.currency) return [];

  const { data, error } = await db
    .from('communication_rates')
    .select('channel, currency, unit_amount_minor')
    .eq('currency', input.currency.toUpperCase());

  if (error) {
    throw new DomainError(error.message, 'credits.rates_failed');
  }

  return (data ?? []).flatMap((row) =>
    isChannel(row.channel)
      ? [
          {
            channel: row.channel,
            currency: row.currency,
            unitAmountMinor: Number(row.unit_amount_minor),
          },
        ]
      : [],
  );
}

/**
 * Everything the settings screen needs to say about money for reaching people.
 *
 * One call rather than three, because the three questions are only meaningful together: a
 * balance with no rate beside it does not say how long it lasts, and a rate with no balance does
 * not say whether anything can be spent.
 */
export async function communicationsAccount(
  db: Db,
  input: { organizationId: string; currency: string | null },
): Promise<{ balanceMinor: number; rates: Rate[]; priced: boolean }> {
  const [balanceMinor, rates] = await Promise.all([
    creditBalance(db, input),
    listRates(db, { currency: input.currency }),
  ]);

  return { balanceMinor, rates, priced: rates.length > 0 };
}
