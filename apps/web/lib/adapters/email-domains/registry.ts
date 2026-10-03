import type { SendingDomainProvider } from './index';
import { goldApiSendingDomainProvider } from './gold-api';

/**
 * Which implementation this deployment uses — the only file outside an implementation that names
 * one. There is one: `apps/api`, which holds the provider credential. Unlike answering, there is
 * no null case: a deployment with no API configured refuses the action loudly
 * (`callDomainCommand`'s `api.unconfigured`), and the domain layer reports that as the provider
 * being unavailable.
 */
export function sendingDomainProvider(input: { token: string }): SendingDomainProvider {
  return goldApiSendingDomainProvider(input);
}

/**
 * What `organization_provider_resources.resource_type` calls a sending domain. The resource type
 * carries the vendor's name, so like `TELEPHONY_RESOURCE_TYPES` it is declared once in the
 * capability's registry and read from here; `lib/domain/` never spells it (I15).
 */
export const SENDING_DOMAIN_RESOURCE_TYPE = 'resend_domain';
