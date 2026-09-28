import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Slice 0A. Today, Schedule visibility is organization-wide: `listSchedule`/`listScheduleDays`
 * and the `resources`/`work_items` select policies filter on tenant membership alone, and
 * `resources` carries no member/user identity column. Neither "own schedule" nor "team
 * schedule" exists yet — and that absence is a CURRENT FACT, not a permanent rule (unlike the
 * genuinely permanent absences in CLAUDE.md's own table). A real Resource<->Membership
 * relationship, once one exists, is meant to make "own schedule" real.
 *
 * What this guards is narrower and does stay true regardless of that future work: nobody may
 * *fake* a narrower visibility scope in the meantime by inferring "this resource/schedule
 * entry belongs to this caller" from something that was never designed to carry that meaning —
 * a role's name, a resource's free-text name, `created_by`, a custom field, or a display name.
 * Any of those would look like scoped visibility while actually being a coincidence of naming,
 * and would silently break the day two businesses name a resource "Alex" for different reasons.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('Schedule visibility scoping is not faked ahead of a real Resource<->Membership relationship', () => {
  it('scheduling reads filter by organization membership only — no per-caller narrowing inside the domain layer', () => {
    const availability = read('lib/domain/scheduling/availability.ts');

    // The two read functions must still only scope by organization_id; a caller-narrowing
    // .eq/.match on user_id, member_id, created_by, or a resource's own name would be exactly
    // the fake heuristic this test exists to catch.
    const forbiddenNarrowing = [
      /resources[^;]*created_by/i,
      /work_items[^;]*created_by/i,
      /\.eq\(\s*['"]user_id['"]/,
      /\.eq\(\s*['"]member_id['"]/,
      /\.eq\(\s*['"]resources?\.name['"]/,
    ];
    for (const pattern of forbiddenNarrowing) {
      expect(availability, `availability.ts must not narrow reads with ${pattern}`).not.toMatch(pattern);
    }
  });

  it('no scheduling or resources domain file infers "mine" from a name, role, or custom field', () => {
    for (const file of [
      'lib/domain/scheduling/availability.ts',
      'lib/domain/scheduling/schedule.ts',
      'lib/domain/scheduling/operating-hours.ts',
    ]) {
      const source = read(file);
      // A heuristic scope check would compare a resource's display name or a role's name
      // against the caller's own display name/role — nothing here has a caller's displayName
      // in scope at all, and it must stay that way until an explicit relationship exists.
      expect(source, `${file} must not compare against displayName as an identity heuristic`).not.toMatch(
        /displayName/,
      );
      expect(source, `${file} must not read role.name as a visibility input`).not.toMatch(/role\.name/);
      expect(source, `${file} must not read a custom field as an identity link`).not.toMatch(
        /custom\??\.\w+\s*===/,
      );
    }
  });

  it('the resources table carries no column presented as an identity link today', () => {
    // A guard against the CURRENT absence being silently reintroduced through the back door of
    // a differently-named column that means the same thing, without anyone deciding to add the
    // real relationship. This does not forbid a future `membership_id` column — it forbids one
    // arriving disguised as something else (e.g. a "primary_operator" free-text field).
    const resourcesMigration = read(join('..', '..', 'supabase', 'migrations', '20260827000002_resources.sql'));
    for (const disguisedIdentityColumn of ['primary_operator', 'assigned_to', 'owner_name', 'technician_name']) {
      expect(resourcesMigration, `resources.sql must not add a disguised identity column "${disguisedIdentityColumn}"`).not.toContain(
        disguisedIdentityColumn,
      );
    }
  });
});
