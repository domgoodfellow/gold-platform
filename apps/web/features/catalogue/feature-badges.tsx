import { Badge } from '@/components/display/data';
import type { CatalogFeature } from '@/lib/domain/catalogue/catalogue';
import type { ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import { ImplementationStateBadge } from '@/features/catalogue/implementation-state';
import { featureOperationalState } from '@/lib/domain/catalogue/feature-operational-state';

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
 * What one organization holds of one Feature, for staff — the same `featureOperationalState`
 * classification the organization's own Settings → Features reads, so the two never disagree.
 * An unsupported Feature earns no entitlement badge: `FeatureStatusBadges` beside it already
 * says Planned or Partial, which is the accurate implementation metadata staff need.
 */
export function EntitlementStatus({ state }: { state: ResolvedFeatureState }) {
  switch (featureOperationalState(state)) {
    case 'unsupported':
      return null;
    case 'not_included':
      return <Badge>Not included</Badge>;
    case 'disabled':
      return <Badge tone="neutral">Included · Off</Badge>;
    case 'ready':
    case 'setup_required':
      return <Badge tone="success">Included · On</Badge>;
  }
}
