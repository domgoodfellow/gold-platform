import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const ORG = `${WEB}/app/organizations/[organizationId]`;

describe('GOLD Internal operating context composition', () => {
  const helper = readFileSync(`${WEB}/lib/domain/tenancy/gold-internal.ts`, 'utf8');
  const layout = readFileSync(`${ORG}/layout.tsx`, 'utf8');
  const shell = readFileSync(`${ORG}/org-shell.tsx`, 'utf8');

  it('identifies only current base-plan assignments for actual memberships, never a business name', () => {
    expect(helper).toContain('currentPlanAssignment');
    expect(helper).toContain("plan?.key === 'gold_internal'");
    expect(helper).not.toContain('organization.name');
    expect(helper).toContain('multiple_organizations');
  });

  it('passes a server-resolved internal-workspace fact into the organization sidebar', () => {
    expect(layout).toContain('findGoldInternalOrganization');
    expect(layout).toContain('isGoldInternal={isGoldInternal}');
    expect(shell).toContain('PLATFORM_NAV');
    expect(shell).toContain('platformStaff && isGoldInternal');
  });

  it('keeps platform destinations in the same mobile navigation when GOLD is current', () => {
    const phoneStart = shell.indexOf('export function OrgNavBar');
    const phone = shell.slice(phoneStart, shell.indexOf('export function SetupEntry'));
    expect(phone).toContain('platformStaff && isGoldInternal');
    expect(phone).toContain('PLATFORM_NAV.map');
  });
});
