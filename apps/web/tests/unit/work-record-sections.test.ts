import { describe, expect, it } from 'vitest';
import { resolveWorkSection, workSectionHref, WORK_SECTIONS } from '@/features/work/work-record-sections';

/**
 * The Work record's section addresses: each section has one, Overview is the bare record, the
 * former `?tab=` links (Finance's `?tab=financials`) still open the same section, and anything else
 * falls back to Overview.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';

describe('Work record sections', () => {
  it('gives every section its own address, Overview the bare record', () => {
    expect(WORK_SECTIONS.map(section => workSectionHref(ORG, JOB, section))).toEqual([
      `/organizations/${ORG}/work/${JOB}`,
      `/organizations/${ORG}/work/${JOB}?section=execution`,
      `/organizations/${ORG}/work/${JOB}?section=financials`,
      `/organizations/${ORG}/work/${JOB}?section=documents`,
      `/organizations/${ORG}/work/${JOB}?section=activity`,
    ]);
  });

  it('reads ?section=, then a former ?tab=, and falls back to Overview', () => {
    for (const section of WORK_SECTIONS) expect(resolveWorkSection({ section })).toBe(section);
    expect(resolveWorkSection({ tab: 'financials' })).toBe('financials');
    expect(resolveWorkSection({ section: 'documents', tab: 'financials' })).toBe('documents');
    expect(resolveWorkSection({ section: 'margin' })).toBe('overview');
    expect(resolveWorkSection({ section: ['execution', 'activity'] })).toBe('overview');
    expect(resolveWorkSection({})).toBe('overview');
  });
});
