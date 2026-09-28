import type { DomainProvider } from './index';
import { goldApiDomainProvider } from './gold-api';

/**
 * Which implementation this deployment uses — the only file outside an implementation that names
 * one. There is one: `apps/api`, which holds the hosting credential. Unlike answering, there is no
 * null case: a deployment with no API configured refuses the action loudly (`callDomainCommand`'s
 * `api.unconfigured`), and the domain layer reports that as the provider being unavailable.
 */
export function domainProvider(input: { token: string }): DomainProvider {
  return goldApiDomainProvider(input);
}

/**
 * The hosting provider GildOps attaches tenant hostnames at, for the Platform screens that
 * configure its account. Route and adapter code may name it; `lib/domain/` never does (I15).
 */
export function domainHostingProviderKey(): string {
  return 'vercel';
}
