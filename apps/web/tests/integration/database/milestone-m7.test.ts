import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueInvoice } from '@/lib/domain/billing/invoices';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import {
  createDashboard,
  listDashboards,
  pinReport,
  readDashboard,
} from '@/lib/domain/reporting/dashboards';
import {
  listReportDefinitions,
  saveReportDefinition,
  setReportRoles,
} from '@/lib/domain/reporting/definitions';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { foundBusiness } from '@/tests/support/founding';

/**
 * M7: *an operator defines a report — entity, fields, filters, grouping, period — pins it to a
 * dashboard, and shares it with a role, without anything about that report or that dashboard
 * existing in code.*
 *
 * **The last clause is the milestone and the assertions about figures are secondary**, exactly
 * as M3's structure was the milestone rather than its numbers. So this test does two things a
 * suite of unit tests would not.
 *
 * It builds **two businesses that share no word** — a dive school in Cebu reporting in pesos and
 * a joinery in Tallinn reporting in euro — each with its own reports, its own dashboards and its
 * own roles, through one set of functions with no branch in them. And it then **reads its own
 * source and the reporting layer's**, failing if either tenant's report name, dashboard name or
 * role name appears anywhere in `lib/domain/reporting/`. A report that existed in code would be
 * a report the platform shipped, which is the thing this milestone exists to make impossible.
 *
 * The person doing all of it is **not the founder**, because "an operator defines a report" is a
 * claim about somebody at the business rather than about whoever set it up.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Everything a tenant says about itself. Not one of these words may reach the source. */
const CEBU = {
  business: 'Mactan Reef School',
  zone: 'Asia/Manila',
  currency: 'PHP',
  work: 'Dive',
  status: 'Booked',
  service: 'Guided descent',
  customer: 'Lapu-Lapu Resort',
  analystRole: 'Dive master',
  report: 'What the reef brings in',
  dashboard: 'Season board',
};

const TALLINN = {
  business: 'Kalamaja Puutöö',
  zone: 'Europe/Tallinn',
  currency: 'EUR',
  work: 'Töö',
  status: 'Tellitud',
  service: 'Trepi paigaldus',
  customer: 'Vanalinna Kinnisvara',
  analystRole: 'Meister',
  report: 'Kliendi käive',
  dashboard: 'Kuu ülevaade',
};

type Shape = typeof CEBU;

type Business = {
  founder: SupabaseClient;
  /** Somebody who is not the founder, and who does the reporting. */
  operator: SupabaseClient;
  organizationId: string;
  analystRoleId: string;
};

async function account(label: string): Promise<{ db: SupabaseClient; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;

  return { db, email };
}

/**
 * One business, from nothing to a dashboard, in its own words.
 *
 * **No branch on which shape it is holding**, which is the same structural claim
 * `configureBusiness` makes one milestone earlier. Every difference between the two businesses
 * below is a value passed in.
 */
async function standUp(shape: Shape, label: string): Promise<Business> {
  const founder = await account(`${label}-founder`);
  const organizationId = await foundBusiness({
    ownerEmail: founder.email,
    name: shape.business,
    displayName: 'Founder',
    timezone: shape.zone,
    currency: shape.currency,
  });

  const typeId = await createWorkItemType(founder.db, { schedulable: true, organizationId, name: shape.work });
  const statusId = await createWorkItemStatus(founder.db, {
    organizationId,
    typeId,
    name: shape.status,
    position: 0,
  });
  const priceId = await createPriceBookItem(founder.db, {
    organizationId,
    name: shape.service,
    unit: 'each',
    unitAmountMinor: 30_000,
  });
  const customerId = await createCustomer(founder.db, {
    organizationId,
    name: shape.customer,
  });

  const workItemId = await createWorkItem(founder.db, {
    organizationId,
    statusId,
    title: shape.service,
    customerId,
  });
  await addPricedLine(founder.db, { workItemId, priceBookItemId: priceId, quantity: 2 });
  await issueInvoice(founder.db, { workItemId, issuedAt: '2026-08-18T04:00:00.000Z' });

  // The person who does the reporting is a colleague, in a role the business named itself.
  const analystRoleId = await createRole(founder.db, {
    organizationId,
    name: shape.analystRole,
    capabilities: ['report.read', 'report.manage'],
  });
  const operator = await account(`${label}-operator`);
  await addMember(founder.db, {
    organizationId,
    email: operator.email,
    displayName: shape.analystRole,
    roleId: analystRoleId,
  });

  return {
    founder: founder.db,
    operator: operator.db,
    organizationId,
    analystRoleId,
  };
}

let cebu: Business;
let tallinn: Business;

describe('M7 — a business defines its own reports and dashboards', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    cebu = await standUp(CEBU, 'm7-cebu');
    tallinn = await standUp(TALLINN, 'm7-tallinn');
  });

  it('lets an operator who is not the founder define, pin and share a report', async () => {
    for (const [shape, business] of [
      [CEBU, cebu],
      [TALLINN, tallinn],
    ] as const) {
      // Defined: a grouping, a period and a filter — which for this report set is the whole of
      // §17's entity, fields, filters, grouping and period.
      const reportId = await saveReportDefinition(business.operator, {
        organizationId: business.organizationId,
        name: shape.report,
        measure: 'invoiced_and_incurred',
        grouping: 'service',
        period: 'all',
      });

      // Pinned.
      const dashboardId = await createDashboard(business.operator, {
        organizationId: business.organizationId,
        name: shape.dashboard,
      });
      await pinReport(business.operator, {
        organizationId: business.organizationId,
        dashboardId,
        reportId,
        position: 0,
      });

      // Shared with a role the business named itself.
      await setReportRoles(business.operator, {
        organizationId: business.organizationId,
        reportId,
        roleIds: [business.analystRoleId],
      });

      // And it answers, in this business's own words and its own currency.
      const tiles = await readDashboard(business.operator, {
        organizationId: business.organizationId,
        dashboardId,
        today: '2026-08-30',
      });

      expect(tiles.map((tile) => tile.report.name)).toEqual([shape.report]);

      const figures = tiles[0].result;
      expect(figures.measure).toBe('invoiced_and_incurred');
      if (figures.measure !== 'invoiced_and_incurred') throw new Error('wrong measure');
      expect(figures.groups[0]?.label).toBe(shape.service);
      expect(figures.groups[0]?.currency).toBe(shape.currency);
      expect(figures.groups[0]?.invoicedMinor).toBe(60_000);
    }
  });

  it('keeps each business’s reports and dashboards entirely to itself', async () => {
    const cebuReports = await listReportDefinitions(cebu.operator, {
      organizationId: cebu.organizationId,
    });
    const tallinnReports = await listReportDefinitions(tallinn.operator, {
      organizationId: tallinn.organizationId,
    });

    expect(cebuReports.map((row) => row.name)).toEqual([CEBU.report]);
    expect(tallinnReports.map((row) => row.name)).toEqual([TALLINN.report]);

    // The id is not what narrows: one business's session asking about the other gets nothing,
    // and the two businesses used identical code to produce entirely different rows.
    expect(
      await listDashboards(cebu.operator, { organizationId: tallinn.organizationId }),
    ).toEqual([]);
  });

  it('holds no tenant’s report, dashboard or role anywhere in the reporting layer', async () => {
    // **The milestone.** Everything above could be true of a platform that shipped a report
    // called *What the reef brings in* and let a business turn it on. This is what says it did
    // not: the reporting layer is read as text, and no word either business chose appears in it.
    //
    // The same shape as `milestone-m3.test.ts` reading `configure.ts`, and for the same reason —
    // a structural claim decays silently, and a test that only checked the figures would keep
    // passing on the day somebody added a starter report.
    const sources = await Promise.all(
      [
        'lib/domain/reporting/financials.ts',
        'lib/domain/reporting/definitions.ts',
        'lib/domain/reporting/dashboards.ts',
      ].map((path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8')),
    );

    const layer = sources.join('\n');
    const tenantWords = [CEBU, TALLINN].flatMap((shape) => [
      shape.business,
      shape.work,
      shape.status,
      shape.service,
      shape.customer,
      shape.analystRole,
      shape.report,
      shape.dashboard,
    ]);

    expect(tenantWords.filter((word) => layer.includes(word))).toEqual([]);

    // A negative control, so this cannot pass by reading an empty string.
    expect(layer).toContain('invoiced_and_incurred');
  });
});
