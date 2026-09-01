/**
 * Turning an address into a point, named as a capability rather than as a provider.
 *
 * The second adapter, and it exists for the same reason the first does (I15): domain code
 * names *where is this address* and never names who answers. `adapters.test.ts` reads the tree
 * and fails on a domain file that reaches past this file to an implementation, and on this file
 * carrying a provider's vocabulary.
 *
 * **What a capability may not leak.** No type here carries a provider's identifier, a place id,
 * a confidence score or a formatted address. Two numbers come back, or nothing does. A richer
 * answer is a richer answer *from somebody*, and the moment a domain function holds one it has
 * a provider in it.
 */

/** A point on the earth. The only thing this platform stores about where a place is. */
export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type GeocodingProvider = {
  /** For a message an operator reads, and for nothing that decides anything. */
  readonly name: string;
  /**
   * Where an address is, or null when the provider cannot say.
   *
   * **Null rather than a throw for "not found", and a throw for everything else.** Those are
   * genuinely different answers: an address a provider does not recognise is something the
   * business can fix by typing a better one, and a provider that is refusing or unreachable is
   * not. A caller that could not tell them apart would show the wrong sentence for both.
   *
   * **It returns one answer and never a list.** Choosing between several is a decision, and a
   * decision made inside an adapter is business logic in the wrong place. The provider's own
   * best answer is offered to a person, who accepts it or types their own.
   */
  locate(input: { address: string }): Promise<Coordinates | null>;
};

/**
 * The configured provider, or `null` when this deployment has none.
 *
 * Re-exported rather than defined here for the reason the payments contract records: choosing
 * an implementation is the one operation that must name implementations, and `adapters.test.ts`
 * asserts that this file names none.
 */
export { geocodingProvider } from './registry';
