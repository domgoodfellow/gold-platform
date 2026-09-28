import { Badge } from '@/components/display/data';
import type { CatalogFeature } from '@/lib/domain/catalogue/catalogue';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import { ImplementationStateBadge } from '@/features/catalogue/implementation-state';

/**
 * The four independent axes a Feature carries (section 4 of the brief) — never collapsed into
 * one enum. A Feature can genuinely be beta, available, an add-on, metered and AI-powered all at
 * once, and each badge says one true thing rather than the set trying to say all of them.
 */

const LIFECYCLE_LABEL: Record<CatalogFeature['lifecycle'], string> = {
  experimental: 'Experimental',
  beta: 'Beta',
  stable: 'Stable',
  deprecated: 'Deprecated',
};

const PACKAGING_LABEL: Record<CatalogFeature['packagingDefault'], string> = {
  core: 'Core',
  included: 'Included',
  optional: 'Optional',
  add_on: 'Add-on',
};

export function FeatureStatusBadges({ feature }: { feature: CatalogFeature }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <ImplementationStateBadge state={feature.implementationState} />
      {feature.lifecycle !== 'stable' ? <Badge>{LIFECYCLE_LABEL[feature.lifecycle]}</Badge> : null}
      <Badge>{PACKAGING_LABEL[feature.packagingDefault]}</Badge>
      {feature.metered ? <Badge>Metered</Badge> : null}
      {feature.aiPowered ? <Badge tone="accent">AI</Badge> : null}
    </div>
  );
}

/**
 * What one organization sees of one Feature — resolved state handed in, never computed here
 * (section 21: "does not receive authorization logic, it receives resolved domain state").
 */
export type OrganizationFeatureState =
  | { kind: 'not_implemented' } // catalogue implementation_state is planned/partial and not entitled either
  | { kind: 'planned' } // implemented nowhere yet, regardless of entitlement
  | { kind: 'not_included' } // available, but this organization's Plan does not grant it
  | { kind: 'included_off' } // granted, but not switched on (no runtime mapping is "wanted")
  | { kind: 'included_on' }; // granted and switched on

/** Combines catalogue implementation with the resolved entitlement/activation facts — never authorization logic of its own, only presentation of what was already resolved (section 21). */
export function deriveOrganizationFeatureState(resolved: ResolvedFeatureState): OrganizationFeatureState {
  if (resolved.implementationState !== 'available') return { kind: 'planned' };
  if (!resolved.entitled) return { kind: 'not_included' };
  return resolved.activation === 'active' ? { kind: 'included_on' } : { kind: 'included_off' };
}

export function EntitlementStatus({ state }: { state: OrganizationFeatureState }) {
  switch (state.kind) {
    case 'planned':
      return <Badge>Planned</Badge>;
    case 'not_included':
      return <Badge>Not included</Badge>;
    case 'included_off':
      return <Badge tone="neutral">Included · Off</Badge>;
    case 'included_on':
      return <Badge tone="success">Included · On</Badge>;
    case 'not_implemented':
    default:
      return <Badge>Not available</Badge>;
  }
}
