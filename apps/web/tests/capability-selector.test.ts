import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { CAPABILITY_GROUPS } from '@/features/tenancy/capability-selector';

/**
 * The one grouping a human sees of `CAPABILITIES` — every capability in exactly one group, so a
 * capability added to the platform vocabulary without a home here fails at the gate rather than
 * silently having no checkbox anywhere it can be granted.
 */
describe('the capability selector groups every capability exactly once', () => {
  it('covers every declared capability', () => {
    const grouped = CAPABILITY_GROUPS.flatMap((g) => g.capabilities);
    expect(grouped.slice().sort()).toEqual([...CAPABILITIES].sort());
  });

  it('names no capability twice', () => {
    const grouped = CAPABILITY_GROUPS.flatMap((g) => g.capabilities);
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
