import { describe, expect, it } from 'vitest';
import { READINESS_PRESENTATION, classifySetupEvidence, evidenceFromSetupArea, type ReadinessState } from '@/lib/application/readiness/evidence';
import type { SetupArea } from '@/lib/domain/tenancy/lifecycle';

const area = (over: Partial<SetupArea> & { importance?: 'required' | 'recommended' | 'optional' }): SetupArea =>
  ({ key: 'k', label: 'Label', message: 'Message', area: { href: '/organizations/o/x', label: 'X' }, state: 'incomplete', importance: 'optional', ...over }) as SetupArea;

describe('readiness evidence', () => {
  it('words every state, and only an unavailable read is danger', () => {
    const states = Object.keys(READINESS_PRESENTATION) as ReadinessState[];
    expect(states.length).toBe(8);
    for (const state of states) expect(READINESS_PRESENTATION[state].label.length).toBeGreaterThan(0);
    expect(states.filter((state) => READINESS_PRESENTATION[state].tone === 'danger')).toEqual(['unavailable']);
    // Unknown is never presented as healthy.
    expect(READINESS_PRESENTATION.unknown.tone).toBe('neutral');
    expect(READINESS_PRESENTATION.unknown.label).not.toMatch(/ready|operational|ok/i);
  });

  it('only a required gap blocks; recommended and optional gaps are suggestions', () => {
    const evidence = [
      evidenceFromSetupArea(area({ key: 'a', importance: 'required' })),
      evidenceFromSetupArea(area({ key: 'b', importance: 'recommended' })),
      evidenceFromSetupArea(area({ key: 'c', importance: 'optional' })),
      evidenceFromSetupArea(area({ key: 'd', state: 'complete' } as Partial<SetupArea>)),
    ];
    const grouped = classifySetupEvidence(evidence);
    expect(grouped.blockers.map((entry) => entry.key)).toEqual(['a']);
    expect(grouped.recommendations.map((entry) => entry.key)).toEqual(['b']);
    expect(grouped.optional.map((entry) => entry.key)).toEqual(['c']);
  });

  it('a finished area is configured, not operational: Setup does not verify anything', () => {
    expect(evidenceFromSetupArea(area({ state: 'complete' } as Partial<SetupArea>)).state).toBe('configured');
  });

  it('keeps the corrective destination the domain supplied', () => {
    expect(evidenceFromSetupArea(area({ importance: 'required' })).destination?.href).toBe('/organizations/o/x');
  });
});
