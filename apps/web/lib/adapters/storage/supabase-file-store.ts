import type { Db } from '@/lib/db/types';
import type { FileStore } from '@/lib/domain/files/storage-port';

/**
 * The Supabase Storage implementation of the file store. It runs under the caller's own token: a
 * service-role client would bypass the bucket policy that pins a path to the caller's tenant.
 */
export function supabaseFileStore(db: Db, bucket: string): FileStore {
  return {
    async put(path, body, contentType) {
      // The bucket reads the type from the body, not from the option, so the body is re-typed here.
      const typed = new Blob([body], { type: contentType });
      const { error } = await db.storage.from(bucket).upload(path, typed, { contentType, upsert: false });
      if (error) throw new Error(error.message);
    },

    async remove(paths) {
      await db.storage.from(bucket).remove(paths);
    },

    async sign(path, ttlSeconds, downloadName) {
      const { data, error } = await db.storage.from(bucket).createSignedUrl(path, ttlSeconds, { download: downloadName });
      if (error || !data) throw new Error(error?.message ?? 'Could not sign that URL.');
      return data.signedUrl;
    },
  };
}
