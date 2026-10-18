import { readFileSync } from 'node:fs';

const directGuard = /require(Organization|OrganizationForBillingRecovery|PlatformArea|ConfigurationTarget|WorkspaceConfiguration|OperatingArea)\(/;
const calendar = readFileSync(new URL('../../features/calendar/workspace-calendar-page.tsx', import.meta.url), 'utf8');

export function hasOrganizationPageGuard(source: string): boolean {
  if (directGuard.test(source)) return true;
  return /import\s*\{\s*WorkspaceCalendarPage\s*\}\s*from\s*['"]@\/features\/calendar\/workspace-calendar-page['"]/.test(source)
    && /return\s+<WorkspaceCalendarPage\b/.test(source)
    && !/getDb|@\/lib\/(domain|db)/.test(source)
    && /await requireOrganization\(organizationId\)/.test(calendar);
}
