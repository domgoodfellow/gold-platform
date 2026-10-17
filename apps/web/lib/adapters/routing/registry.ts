import type { RoutingProvider } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that names
 * one. Null when unconfigured: travel is then *unverified*, never zero, and scheduling says so.
 * "Configured" means the address of a routing service the deployment operates or rents; a keyless
 * service has no credential for this runtime to hold, and a credentialed one belongs behind the
 * API runtime's provider accounts, not here.
 */
export async function routingProvider(): Promise<RoutingProvider | null> {
  const baseUrl = process.env.ROUTING_BASE_URL;
  if (!baseUrl) return null;

  const { osrmRoutingProvider } = await import('./osrm');
  return osrmRoutingProvider({ baseUrl });
}
