import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Home is the organization's landing and Insights its deep analytics. What is held here is what
 * no rendering test could see: that Home reads only what a business has, and computes nothing.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ROUTES = `${WEB}/app/organizations/[organizationId]`;
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');

describe('Home', () => {
  const page = read('app/organizations/[organizationId]/home/page.tsx');
  const dashboard = read('features/home/home-dashboard.tsx');

  it('is the one implementation — there is no second Today', () => {
    expect(existsSync(`${ROUTES}/today`)).toBe(false);
    expect(existsSync(`${WEB}/features/today`)).toBe(false);
  });

  it('reads an optional block only when navigation would show that workspace to this role', () => {
    expect(page).toContain("has('calls')");
    expect(page).toContain("has('automations')");
    expect(page).toContain("has('insights')");
    expect(page).toContain('areaAvailable');
    // The read itself is conditional, so no query runs for a capability a business does not hold.
    expect(page).toMatch(/hasCommunications \? listCalls/);
    expect(page).toMatch(/hasAutomation \? listAutomationRuns/);
    expect(page).toMatch(/hasFinancials\s*\? listInvoicedAndIncurred/);
  });

  it('takes every figure from a domain read: no query and no arithmetic of its own', () => {
    expect(dashboard).not.toMatch(/\.from\(|\.rpc\(|\.reduce\(|getDb|createClient/);
    // Money is disclosed through the aggregate's own per-currency totals.
    expect(page).toContain('totalsByCurrency');
    // Home invents no measure: no revenue, growth or forecast wording anywhere.
    expect(dashboard + page).not.toMatch(/revenue|growth|forecast|trend/i);
  });

  it('draws an absent block as nothing, never as a zero', () => {
    for (const block of ['communications', 'automation', 'financials']) {
      expect(dashboard, `${block} may be null`).toMatch(new RegExp(`${block}: [^;]*\| null|${block}: \{[^}]*\} \| null`));
    }
    expect(dashboard).toContain('data.communications &&');
    expect(dashboard).toContain('data.automation && failures > 0');
    expect(dashboard).toContain('if (data.financials)');
  });

  it('is an intentional page for an empty business rather than a wall of zeroes', () => {
    expect(dashboard).toContain('Nothing recorded yet');
    expect(dashboard).toMatch(/if \(!empty\)/);
  });
});

describe('Insights', () => {
  it('has an Overview of saved dashboards and a Reports view, each its own route', () => {
    expect(existsSync(`${ROUTES}/insights/page.tsx`)).toBe(true);
    expect(existsSync(`${ROUTES}/insights/reports/page.tsx`)).toBe(true);
    expect(read('app/organizations/[organizationId]/insights/page.tsx')).toContain('listDashboards');
    expect(read('app/organizations/[organizationId]/insights/page.tsx')).not.toContain('listInvoicedAndIncurred');
  });

  it('keeps the full report a page: the report builder is never composed into a rail', () => {
    const reports = read('app/organizations/[organizationId]/insights/reports/page.tsx');
    expect(reports).toContain('ReportResultView');
    expect(reports).not.toContain('SupportRegistrar');
    const rail = read('features/insights/workspace-insights.tsx');
    expect(rail).not.toMatch(/ReportFilters|ReportManagement|ReportResultView|ReportNavigation|DataTable/);
  });

  it('sends the old Reports address, and a saved dashboard on it, to their Insights homes', () => {
    const config = read('next.config.ts');
    expect(config).toContain('has: [{ type: "query", key: "dashboard" }], destination: "/organizations/:organizationId/insights"');
    expect(config).toContain('destination: "/organizations/:organizationId/insights/reports"');
  });
});
