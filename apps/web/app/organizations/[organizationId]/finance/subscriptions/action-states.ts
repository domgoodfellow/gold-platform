/** What a subscription change answered: a refusal, or that it was recorded (with the id it created, where it created one). */
export type SubscriptionActionState = { error: string | null; recorded: boolean; id?: string | null };
export const SUBSCRIPTION_ACTION_INITIAL: SubscriptionActionState = { error: null, recorded: false, id: null };
