import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
import type { Db } from '@/lib/db/types';

/**
 * A business's own OAuth connection, relayed to `apps/api` (D56).
 *
 * **This runtime holds no token, no client secret and no state-signing secret, and never sees a
 * credential.** It forwards the caller's own token and a browser's one-time values; the API proves
 * the person may manage integrations for that business, does the handshake, and stores the
 * credential where only its machine role can read it. What comes back is a URL to send the
 * browser to, or a connection id — never a secret.
 */

async function operate<T>(db: Db, operation: string, args: Record<string, unknown>): Promise<T> {
  return callDomainCommand<T>('/integrations/operate', {
    token: await requireAccessToken(db),
    body: { operation, arguments: args },
  });
}

/** Where to send the browser to sign in, and the one-time value to keep in its own cookie. */
export function beginOAuth(
  db: Db,
  input: { organizationId: string; connectorKey: string; connectionId?: string },
): Promise<{ url: string; nonce: string }> {
  return operate(db, 'begin', {
    organization_id: input.organizationId,
    connector_key: input.connectorKey,
    connection_id: input.connectionId ?? null,
  });
}

export function completeOAuth(
  db: Db,
  input: { code: string; state: string; nonce: string },
): Promise<{ organization_id: string; connection_id: string }> {
  return operate(db, 'complete', input);
}

/** Rotate the token if it is near expiry, ask who the account is, list what it reaches, record health. */
export function checkConnection(db: Db, input: { connectionId: string }): Promise<{ ok: boolean; resources: number }> {
  return operate(db, 'sync', { connection_id: input.connectionId });
}

export function disconnectOAuth(db: Db, input: { connectionId: string }): Promise<{ ok: boolean }> {
  return operate(db, 'disconnect', { connection_id: input.connectionId });
}
