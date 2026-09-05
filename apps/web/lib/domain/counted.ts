/**
 * A list that knows whether it is all of them.
 *
 * **It was called `ListPage` and that was a bad name in this repository specifically.** Every
 * route file here is `page.tsx`, so a type with `Page` in it reads as a screen — and the first
 * person to meet it read it as one and asked why a list needed its own page. It is a *count*
 * attached to some rows; naming it after the count is the only reading that cannot be mistaken
 * for a route.
 *
 * **This exists because PostgREST truncates silently.** An unbounded `select` is answered with
 * the server's first thousand rows and nothing at all to say that it did — so every list in this
 * application had a page size nobody chose, no way to reach the next page, and a cliff a business
 * would meet without being told. A business doing ten jobs a day crosses a thousand work items in
 * about three months, at which point its board quietly stops showing the oldest.
 *
 * **The type is an array, not a `{ items, total }` object, and that is a deliberate choice with a
 * real trade-off.** The object shape is the more conventional one and it was the first draft. What
 * decided against it is where the callers are: the great majority read these lists to populate a
 * `<select>`, to assert in a test, or to `.find` one row — `expect(await listWorkItems(…)).toEqual([])`
 * reads as a sentence, and `expect((await listWorkItems(…)).items).toEqual([])` does not. Making
 * forty of those worse to give six screens a number is a bad trade, and it is the kind of churn
 * that gets a good idea reverted.
 *
 * **`total` is lost by `.map`, `.filter` and spreading, and that is correct rather than a
 * footgun.** Those produce a *different* list, and the number of rows the database holds for the
 * original query says nothing true about the new one. A shape that carried the total through a
 * filter would be the misleading one.
 *
 * What this does **not** do is paginate. There is no cursor, no next page and no offset, because
 * nothing has asked for one — what it buys is that a screen can now say *showing 500 of 1,432*
 * instead of showing 1,000 and implying that is everything. The remedy for a business that
 * genuinely has more than a page is a filter or a search, and that is a feature with its own
 * slice.
 */
export type Counted<T> = T[] & {
  /** How many rows the query matches, which is not always how many are here. */
  total: number;
};

/**
 * How many rows a list reads at once.
 *
 * **A number this codebase chooses**, which is the entire point: the alternative is not "no
 * limit", it is PostgREST's thousand. Five hundred is several screenfuls of anything and is not a
 * claim about how much work a business does.
 */
export const LIST_LIMIT = 500;

/**
 * Attach the count to the rows.
 *
 * `count` is null when the server did not answer with one, and the fallback is the number of rows
 * in hand — which reads as *this is all of them*. That is the honest answer when nothing better is
 * known, and it is exactly what every caller assumed before this existed.
 *
 * **`total` is non-enumerable, and the test suite is what proved that necessary.** The first
 * version used `Object.assign`, which makes it an ordinary property — so `toEqual([])` in ten
 * suites started failing with *expected `[ , total: +0 ]` to deeply equal `[]`*, and the whole
 * argument for this shape (that the call sites do not change) was false as written. Hiding it
 * from enumeration is not a way of getting those tests to stop complaining: it is the accurate
 * statement of what this value is. `toEqual` compares a list's **contents**, and how many rows
 * the database holds is not one of its contents. Spreading, `.map` and `.filter` drop it for the
 * same reason they always did.
 *
 * **It does not cross a client boundary.** Serialising a `Counted` into a client component's
 * props gives that component a plain array with no `total` and no error, because a non-enumerable
 * property is not serialised — so read it on the server, which is where every caller reads it
 * today. If a client component ever needs the number, pass the number.
 */
export function counted<T>(items: T[], count: number | null | undefined): Counted<T> {
  return Object.defineProperty(items, 'total', {
    value: count ?? items.length,
    enumerable: false,
    writable: false,
    configurable: true,
  }) as Counted<T>;
}
