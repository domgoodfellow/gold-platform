import { Badge } from '@/components/display/data';
import type { TenantHealth } from '@/lib/domain/providers/reconciliation';
import type { ProviderReadiness } from '@/lib/domain/providers/status';

const LABEL: Record<TenantHealth, string> = {
  not_provisioned: 'Not provisioned',
  provisioning: 'Provisioning',
  failed: 'Failed',
  suspended: 'Suspended',
  in_sync: 'In sync',
  remote_missing: 'Missing at provider',
  remote_changed: 'Changed at provider',
  unchecked: 'Provisioned',
};

/**
 * These are the platform's own states about its own infrastructure, so unlike a tenant's status
 * word they may carry meaning. A problem is marked in text and colour; the label always says it.
 */
const PROBLEM: ReadonlySet<TenantHealth> = new Set(['failed', 'remote_missing', 'remote_changed']);

export function TenantHealthBadge({ health }: { health: TenantHealth }) {
  return (
    <Badge tone={health === 'in_sync' ? 'success' : PROBLEM.has(health) ? 'danger' : 'neutral'}>
      {LABEL[health]}
    </Badge>
  );
}

export function ReadinessBadge({ state }: { state: ProviderReadiness['state'] }) {
  return (
    <Badge tone={state === 'operational' ? 'success' : state === 'attention' ? 'danger' : 'neutral'}>
      {state === 'operational' ? 'Operational' : state === 'attention' ? 'Needs attention' : 'Not configured'}
    </Badge>
  );
}
