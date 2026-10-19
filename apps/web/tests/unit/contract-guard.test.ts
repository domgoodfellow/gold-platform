import { describe, expect, it } from 'vitest';
import { countTests, evaluate, matchesPattern, parseRationale, protectedPatterns } from '../../../../scripts/contract-guard.mjs';

/** The rules `scripts/contract-guard.mjs` applies to one commit or pull request, without git. */

const patterns = protectedPatterns(`
# comment
/CLAUDE.md          @owner
/docs/decisions/    @owner
/apps/web/e2e/adaptive-shell.spec.ts @owner
`);
const statuses: Record<string, string> = { 'ADR-046': 'Accepted', 'ADR-006': 'Superseded' };
const adrStatus = (id: string) => statuses[id] ?? null;
const run = (files: { path: string; before: string | null; after: string | null }[], rationale = '') => evaluate({ files, rationale, patterns, adrStatus });
const doc = { path: 'docs/decisions/ADR-046-x.md', before: 'a', after: 'b' };

describe('protected paths', () => {
  it('reads CODEOWNERS patterns and matches anchored files and directories only', () => {
    expect(patterns).toEqual(['/CLAUDE.md', '/docs/decisions/', '/apps/web/e2e/adaptive-shell.spec.ts']);
    expect(matchesPattern('CLAUDE.md', '/CLAUDE.md')).toBe(true);
    expect(matchesPattern('apps/web/CLAUDE.md', '/CLAUDE.md')).toBe(false);
    expect(matchesPattern('docs/decisions/ADR-001-scopes.md', '/docs/decisions/')).toBe(true);
    expect(matchesPattern('docs/decisions-old.md', '/docs/decisions/')).toBe(false);
    expect(matchesPattern('apps/web/e2e/visual/a.png', '/apps/web/e2e/visual/')).toBe(true);
  });

  it('passes a change that touches nothing protected and removes no tests', () => {
    expect(run([{ path: 'apps/web/features/x.tsx', before: 'a', after: 'b' }]).errors).toEqual([]);
  });

  it('requires a Contract-Change line for a protected path', () => {
    const result = run([doc], 'Edit wording');
    expect(result.protectedChanged).toEqual([doc.path]);
    expect(result.errors).toHaveLength(1);
  });

  it('accepts an Accepted ADR, refuses a superseded or missing one', () => {
    expect(run([doc], 'Contract-Change: ADR-046').errors).toEqual([]);
    expect(run([doc], 'Contract-Change: ADR-006').errors[0]).toMatch(/Superseded/);
    expect(run([doc], 'Contract-Change: ADR-999').errors[0]).toMatch(/does not exist/);
  });

  it('accepts an approval or correction only with a stated reason', () => {
    expect(run([doc], 'Contract-Change: approved: owner approved in issue 12 on 2026-10-19').errors).toEqual([]);
    expect(run([doc], 'Contract-Change: correction: wrong route name for Dispatch').errors).toEqual([]);
    expect(run([doc], 'Contract-Change: correction: typo').errors).toHaveLength(1);
    expect(run([doc], 'Contract-Change: none').errors).toHaveLength(1);
  });
});

describe('coverage changes', () => {
  const spec = 'apps/web/tests/component/page.test.tsx';
  const two = "it('a', () => {});\nit('b', () => {});";
  // Assembled at run time so this file's own source holds no skip or feature mock for the guard to count.
  const skip = (name: string) => ['it', 'skip'].join('.') + `('${name}', f);`;
  const mockFeature = (module: string) => ['vi', 'mock'].join('.') + `('@/${['features', module].join('/')}', () => ({}));`;

  it('counts cases, skips and feature or component mocks, not describe blocks', () => {
    expect(countTests("describe('g', () => { it('a', f); test('b', f); test.describe('c', f); });")).toEqual({ cases: 2, skips: 0, mocks: 0 });
    expect(countTests(`${skip('a')} ${['x', "it('b', f);"].join('')}`)).toMatchObject({ cases: 0, skips: 2 });
    expect(countTests(`${mockFeature('x')} ${['vi', 'mock'].join('.')}('next/navigation');`).mocks).toBe(1);
    expect(countTests('def test_a():\n  pass\n@pytest.mark.skip\ndef test_b(): pass', 'test_x.py')).toMatchObject({ cases: 2, skips: 1 });
  });

  it('requires a Coverage-Change line when a case is removed, skipped or a feature is newly mocked', () => {
    expect(run([{ path: spec, before: two, after: "it('a', () => {});" }]).errors).toHaveLength(1);
    expect(run([{ path: spec, before: two, after: `it('a', () => {});\n${skip('b')}` }]).coverageChanges[0]).toMatch(/removed, 1 skip/);
    expect(run([{ path: spec, before: two, after: `${mockFeature('tenancy/x')}\n${two}` }]).errors).toHaveLength(1);
    expect(run([{ path: spec, before: two, after: null }]).coverageChanges[0]).toMatch(/2 test case/);
  });

  it('accepts a reason, and does not flag added tests', () => {
    expect(run([{ path: spec, before: two, after: "it('a', () => {});" }], 'Coverage-Change: b protected the retired Library popover, removed by ADR-046').errors).toEqual([]);
    expect(run([{ path: spec, before: two, after: `${two}\nit('c', () => {});` }]).coverageChanges).toEqual([]);
  });

  it('applies both rules to a protected test file', () => {
    const result = run([{ path: 'apps/web/e2e/adaptive-shell.spec.ts', before: two, after: "it('a', () => {});" }]);
    expect(result.errors).toHaveLength(2);
  });
});

describe('rationale', () => {
  it('reads every Contract-Change and Coverage-Change line regardless of case or position', () => {
    expect(parseRationale('Title\n\nbody\ncontract-change: ADR-046\nCoverage-Change: x protected y')).toEqual({ contract: ['ADR-046'], coverage: ['x protected y'] });
  });
});
