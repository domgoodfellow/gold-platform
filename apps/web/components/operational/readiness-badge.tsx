import { StatePill } from './primitives';
import { READINESS_PRESENTATION, type ReadinessState } from '@/lib/application/readiness/evidence';

/** One readiness state, worded and toned the same wherever it appears. */
export function ReadinessBadge({ state }: { state: ReadinessState }) {
  const presentation = READINESS_PRESENTATION[state];
  return <StatePill tone={presentation.tone}>{presentation.label}</StatePill>;
}
