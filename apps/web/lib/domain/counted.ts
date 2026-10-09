/**
 * A list that knows whether it is all of them. Exists because PostgREST truncates silently — an
 * unbounded `select` returns the server's first thousand rows with nothing to say it did, so
 * every list here had a page size nobody chose and a cliff a business would meet unwarned.
 *
 * An array, not `{ items, total }`: most callers read these lists to populate a `<select>`,
 * assert in a test, or `.find` one row, and `expect(await listWorkItems(…)).toEqual([])` reads
 * as a sentence where `.items` wouldn't. `total` is lost by `.map`, `.filter` and spreading —
 * correctly, since those produce a different list and the original count says nothing true
 * about it. No pagination — no cursor, no next page — since nothing has asked for one; this
 * only buys a screen the ability to say "showing 500 of 1,432" instead of implying 1,000 is
 * everything.
 */
export type Counted<T> = T[] & {
  /** Whether PostgREST actually answered the exact-count request. */
  exactCount: number | null;
  /** How many rows the query matches, which is not always how many are here. */
  total: number;
};

/** A number this codebase chooses — the alternative isn't "no limit", it's PostgREST's thousand. */
export const LIST_LIMIT = 500;

/**
 * Attach the count to the rows. `count` is null when the server didn't answer with one, and the
 * fallback — the rows in hand — reads as "this is all of them", the honest answer when nothing
 * better is known. `total` is non-enumerable: an ordinary property broke `toEqual([])` across
 * ten test suites, which was really `toEqual` correctly comparing contents that a row count
 * isn't part of. Doesn't cross a client boundary — a non-enumerable property isn't serialised,
 * so read it on the server; if a client component needs the number, pass the number.
 */
export function counted<T>(items: T[], count: number | null | undefined): Counted<T> {
  Object.defineProperty(items, 'exactCount', { value: count ?? null, enumerable: false, configurable: true });
  return Object.defineProperty(items, 'total', {
    value: count ?? items.length,
    enumerable: false,
    writable: false,
    configurable: true,
  }) as Counted<T>;
}
