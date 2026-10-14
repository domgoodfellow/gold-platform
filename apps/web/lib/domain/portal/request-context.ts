import 'server-only';
import { headers } from 'next/headers';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { normalizeRequestHost } from '@/lib/domain/domains/resolve';
import { isDeploymentHost } from '@/lib/route/hostname';
import { requirePortalContext } from './context';

/** Resolve again on every request. Routing's hostname cache is never authorization. */
export async function requirePortalRequestContext(db: Db) {
  const context = await requirePortalContext(db);
  const host = normalizeRequestHost((await headers()).get('host'));
  if (!host) throw new DomainError('Portal unavailable.', 'portal.hostname_mismatch');
  if (isDeploymentHost(host)) return context;
  const { data, error } = await db.rpc('portal_context_at_hostname', { p_hostname: host });
  if (error || data?.[0]?.organization_id !== context.organizationId) throw new DomainError('Portal unavailable.', 'portal.hostname_mismatch');
  return context;
}
