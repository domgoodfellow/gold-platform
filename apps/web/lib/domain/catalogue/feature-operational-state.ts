import type { ResolvedFeatureState } from './organization-plans';

/**
 * What one resolved Feature means to the organization holding it: the one classification every
 * organization-facing and staff-facing status reads, so two screens cannot describe the same
 * Feature differently. A Feature that is not `available` is `unsupported` whatever its
 * entitlement: it is never usable, never offered as part of a Plan and never switched on or off.
 * Implementation metadata (planned versus partial) stays on the state for staff surfaces.
 *
 * Pure and dependency-free so client presentation can read it without the resolver's server code.
 */
export type FeatureOperationalState = 'ready' | 'setup_required' | 'disabled' | 'not_included' | 'unsupported';

export function featureOperationalState(
  state: Pick<ResolvedFeatureState, 'implementationState' | 'entitled' | 'activation' | 'readiness'>,
): FeatureOperationalState {
  if (state.implementationState !== 'available') return 'unsupported';
  if (!state.entitled) return 'not_included';
  if (state.activation === 'disabled') return 'disabled';
  return state.readiness === 'setup_required' ? 'setup_required' : 'ready';
}

/** The states an organization can operate: shown in Settings → Features with their setup and on/off actions. */
export function isOperationalFeature(state: FeatureOperationalState): boolean {
  return state === 'ready' || state === 'setup_required' || state === 'disabled';
}
