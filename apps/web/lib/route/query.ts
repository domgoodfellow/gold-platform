/** A path with the given search parameters, keeping repeated values — for redirects that keep the query. */
export function withQuery(
  path: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, entry);
    }
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}
