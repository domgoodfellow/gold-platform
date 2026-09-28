import { Badge } from '@/components/display/data';

/**
 * The one implementation-state vocabulary, shared by catalogue Features, provider Services and
 * connector apps — each names the same three words rather than each declaring its own copy.
 */
export type ImplementationState = 'planned' | 'partial' | 'available';

export const IMPLEMENTATION_STATE_LABEL: Record<ImplementationState, string> = {
  planned: 'Planned',
  partial: 'Partial',
  available: 'Available',
};

/**
 * Available is the default a customer or staff member should expect — it earns no badge.
 * `Planned` and `Partial` are the two claims worth calling out, because they say something is
 * not yet what it looks like it should be.
 */
export function ImplementationStateBadge({ state }: { state: ImplementationState }) {
  if (state === 'available') return null;
  return <Badge>{IMPLEMENTATION_STATE_LABEL[state]}</Badge>;
}
