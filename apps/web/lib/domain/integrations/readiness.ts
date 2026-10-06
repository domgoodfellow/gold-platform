import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * Whether this deployment can connect each app — asked of `apps/api`, which holds the adapters and
 * the vendor registrations, and never answered here from a list of keys (I15, one axis over).
 *
 * Three independent facts decide whether a business is offered Connect: the catalogue's product
 * status (`connectors.ts`), this deployment readiness, and — once connected — the business's own
 * connection health (`connections.ts`). None implies another.
 *
 * An unreachable or unconfigured API answers with an empty map, which reads as *nothing is
 * connectable*: a Connect button that a deployment cannot honour is the failure, not a quiet page.
 */

export type ConnectorReadiness = {
  implemented: boolean;
  configured: boolean;
  /** A coarse code. Never an input name and never a value — those are `ConnectorReadinessDetail`'s, for staff. */
  reason: 'adapter_missing' | 'oauth_client_missing' | null;
};

export type ConnectorReadinessDetail = ConnectorReadiness & {
  /** The configuration inputs this connector needs, by name. Values are never carried. */
  requiredConfiguration: string[];
};

type PublicAnswer = { connectors: { connector_key: string; implemented: boolean; configured: boolean; reason: ConnectorReadiness['reason'] }[] };
type DetailAnswer = { redirect_uri: string; connectors: (PublicAnswer['connectors'][number] & { required_configuration: string[] })[] };

async function ask<T>(db: Db, operation: string, keys: readonly string[]): Promise<T> {
  return callDomainCommand<T>('/integrations/operate', {
    token: await requireAccessToken(db),
    body: { operation, arguments: { connector_keys: [...keys] } },
    // A page waits on this, and an unreachable API reads as nothing connectable, so it does not get to hold the page for long.
    timeoutMs: 4_000,
  });
}

/** For any signed-in caller. Empty when the API cannot answer. */
export async function loadConnectorReadiness(db: Db, keys: readonly string[]): Promise<Map<string, ConnectorReadiness>> {
  if (keys.length === 0) return new Map();
  try {
    const answer = await ask<PublicAnswer>(db, 'readiness', keys);
    return new Map(
      answer.connectors.map((item) => [item.connector_key, { implemented: item.implemented, configured: item.configured, reason: item.reason }]),
    );
  } catch (error) {
    if (error instanceof DomainError) return new Map();
    throw error;
  }
}

/** Platform staff only: also says which inputs a connector still needs and where vendors send people back. */
export async function loadConnectorReadinessDetail(
  db: Db,
  keys: readonly string[],
): Promise<{ redirectUri: string | null; byKey: Map<string, ConnectorReadinessDetail> } | null> {
  if (keys.length === 0) return { redirectUri: null, byKey: new Map() };
  try {
    const answer = await ask<DetailAnswer>(db, 'readiness_detail', keys);
    return {
      redirectUri: answer.redirect_uri,
      byKey: new Map(
        answer.connectors.map((item) => [
          item.connector_key,
          {
            implemented: item.implemented,
            configured: item.configured,
            reason: item.reason,
            requiredConfiguration: item.required_configuration,
          },
        ]),
      ),
    };
  } catch (error) {
    if (error instanceof DomainError) return null; // the API is not reachable or not configured: say so, do not guess
    throw error;
  }
}
