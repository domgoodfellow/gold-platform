/**
 * Turning an address into a point, named as a capability rather than a provider (I15).
 * No type here may carry a provider id, a place id, a confidence score, or a formatted
 * address — two numbers come back, or nothing does.
 */

/** A point on the earth. The only thing this platform stores about where a place is. */
export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type GeocodingProvider = {
  readonly name: string;
  /** Null for "not found" (fixable by typing a better address); throws for anything else. One answer, never a list. */
  locate(input: { address: string }): Promise<Coordinates | null>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { geocodingProvider } from './registry';
