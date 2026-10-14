import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/** Projection of existing domain ownership and provider verification; never provisions a host. */
export async function portalOrigin(db: Db, organizationId: string, applicationOrigin: string): Promise<string> {
  const [domains, organization, zone] = await Promise.all([
    db.from('organization_domains').select('hostname,is_primary').eq('organization_id',organizationId).eq('surface','portal').eq('verification_state','verified').eq('ssl_state','issued').is('released_at',null).order('is_primary',{ascending:false}).order('created_at',{ascending:true}).limit(1),
    db.from('organizations').select('slug').eq('id',organizationId).maybeSingle(),
    db.rpc('platform_public_domain'),
  ]);
  if (domains.error || organization.error || zone.error) throw new DomainError('Portal address could not be loaded.','portal.address_failed');
  const host = domains.data?.[0]?.hostname ?? (zone.data && organization.data?.slug ? `${organization.data.slug}.${zone.data}` : null);
  return host ? `https://${host}` : applicationOrigin;
}
