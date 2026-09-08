/**
 * Placing a telephone call, as a capability.
 *
 * **Not a word in here belongs to a vendor** (I15), and `adapters.test.ts` reads this file to
 * hold that from both sides: no domain file may import an implementation, and the contract may
 * not speak a provider's vocabulary. What a caller says is *ring this number into that room*.
 * Which company carries it is `registry.ts`'s only subject.
 *
 * **Three methods, and each arrived with a caller** — which is the bar `constraints.md` sets and
 * the reason there is no `hold`, no `transfer` and no `merge` here yet. All three are one
 * operation on a participant once D38's conference exists, and each gets added by the screen
 * that presses the button rather than in advance of one.
 */

/** What the network is doing, normalised. The same six values `calls.status` allows. */
export type CallStatus =
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'busy';

export type PlacedCall = {
  /**
   * The provider's own id for this leg.
   *
   * Kept so a later callback can find the row it belongs to. It is an opaque string here and
   * must stay one — the moment anything above this file parses it, the shape of one vendor's
   * identifiers has become a fact the platform depends on.
   */
  externalId: string;
  status: CallStatus;
};

export type TelephonyProvider = {
  /**
   * Ring `to` from `from`, and put them in the room called `room`.
   *
   * **A room rather than a direct dial, which is D38.** Both parties join a conference instead
   * of being connected to each other, because hold, transfer, merge and supervision are each
   * one operation on somebody in a room and none of them is possible on a two-party line.
   *
   * `reportTo` is where the carrier should send word of what happens next. Supplied per call
   * rather than configured once at the provider, so a deployment that moves does not leave its
   * calls reporting to an address that no longer answers.
   */
  addToRoom(input: {
    room: string;
    from: string;
    to: string;
    reportTo: string;
  }): Promise<PlacedCall>;

  /**
   * A short-lived credential letting one person's browser act as a telephone.
   *
   * **The thing that makes an agent reachable at all.** Without it a call rings a customer and
   * connects them to nobody, which is what the first reception slice actually did.
   *
   * `identity` is who the browser is claiming to be, and it is this platform's own membership
   * id rather than anything the vendor knows about. It is minted per session and never stored.
   */
  browserToken(input: { identity: string; ttlSeconds?: number }): Promise<string>;
};

/**
 * Re-exported so domain code imports the capability and nothing deeper.
 *
 * `adapters.test.ts` allows a domain file to import `@/lib/adapters/<capability>` exactly, and
 * refuses any path with a second segment — because reaching past this file is how an
 * implementation's name arrives in the domain layer one import at a time. `./registry` is
 * therefore the single place in the tree, outside an implementation, permitted to name a carrier.
 */
export { callbackBase, telephonyProvider } from './registry';
