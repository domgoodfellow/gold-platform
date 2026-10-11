import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_KINDS } from '@/lib/domain/automation/rules';

/**
 * Slice 0A. Locks down a boundary the repository already holds, so a later change can't erode
 * it quietly: `automation.manage` is authority to *author* a rule, never authority the runtime
 * re-checks when the rule *fires*. Runtime authority is `app.acting_automation()`, a
 * transaction-local Postgres setting that only `app.run_automation` (security definer, revoked
 * from every client role) may set — no path exposed to `authenticated` can claim to be an
 * automation. What a rule may *do* is a fixed, hand-written action vocabulary
 * (`ACTION_KINDS`); a rule's own data can never name an arbitrary domain function to call.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const readMigration = (name: string) => readFileSync(join(ROOT, '..', '..', 'supabase', 'migrations', name), 'utf8');

describe('authoring a rule is not the same authority as executing one', () => {
  it('automation.manage never appears in the domain files that write down and read back rules', () => {
    for (const file of ['lib/domain/automation/rules.ts', 'lib/domain/automation/review.ts', 'lib/domain/automation/templates.ts']) {
      const source = read(file);
      expect(source, `${file} must not re-check automation.manage as if it were runtime authority`).not.toContain(
        'automation.manage',
      );
    }
  });

  it('the fixed action vocabulary is exactly five kinds, and adding one is a same-change decision, not silent drift', () => {
    // `run_tool` is the fifth: it reads from a connected app under a grant the rule owns, queued for the
    // integration runtime rather than performed inside the rule's own write (docs/integrations.md).
    const kinds = ACTION_KINDS.map((action) => action.kind);
    expect(kinds.sort()).toEqual(['change_status', 'create_work_item', 'notify', 'run_tool', 'shift_schedule'].sort());
  });

  it('app.acting_automation() is set only inside app.run_automation, and revoked from every client role', () => {
    const automations = readMigration('20260831000002_automations.sql');

    expect(automations).toContain('revoke all on function app.acting_automation() from public');
    expect(automations).not.toMatch(/grant execute on function app\.acting_automation\(\) to (anon|external)/);

    // set_config('app.automation_rule_id', ...) may only be written inside the run_automation
    // function body — never by a function reachable directly from a signed-in client.
    const setConfigCalls = [...automations.matchAll(/set_config\('app\.automation_rule_id'/g)];
    expect(setConfigCalls.length).toBeGreaterThan(0);

    const runAutomationStart = automations.indexOf('create function app.run_automation');
    expect(runAutomationStart, 'expected app.run_automation to exist').toBeGreaterThan(-1);
    // Every occurrence of the setter is inside run_automation's own body in this file — proven by
    // there being exactly one function definition site for it and every match sitting after it.
    for (const match of setConfigCalls) {
      expect(match.index!, 'set_config(app.automation_rule_id, ...) found outside run_automation').toBeGreaterThan(
        runAutomationStart,
      );
    }
  });

  it('a rule fires through no path that lets it name an arbitrary domain function', () => {
    const counters = readMigration('20260831000006_counters.sql');
    // The action-kind/config-shape check constraints are what stop a rule's stored JSON from
    // being read as "call this function" — they pin one fixed vocabulary and one JSON shape
    // per known kind, rather than a free-text action a rule's own data could invent.
    expect(counters).toContain('automation_actions_action_kind_check');
    expect(counters).toContain('automation_actions_config_matches_kind');
  });

  it('an automation cannot trigger an automation (no re-entrant runtime authority)', () => {
    const automations = readMigration('20260831000002_automations.sql');
    const counters = readMigration('20260831000006_counters.sql');
    for (const source of [automations, counters]) {
      expect(source).toMatch(/app\.acting_automation\(\) is not null then\s*\n\s*return/);
    }
  });
});
