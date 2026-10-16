/**
 * What Library needs from object storage, and nothing more: store bytes, remove bytes, and hand out
 * a short-lived link to read them. The domain depends on this shape; the Supabase implementation
 * lives in `lib/adapters/storage`. Every call runs under the caller's own session, so the bucket's
 * policies, not this interface, decide what the caller may touch.
 */
export type FileStore = {
  /** Stores bytes at a path that does not exist yet. Throws with the provider's message when refused. */
  put(path: string, body: Blob, contentType: string): Promise<void>;
  /** Best effort. A refusal leaves the bytes in place and is not reported, because the row is the authority. */
  remove(paths: string[]): Promise<void>;
  /** A signed link that expires after `ttlSeconds`. Throws when the caller may not read the path. */
  sign(path: string, ttlSeconds: number, downloadName: string): Promise<string>;
};
