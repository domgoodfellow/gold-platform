'use server';

import { DomainError } from '@/lib/domain/errors';
import { resetDashboardLayout, saveDashboardLayout } from '@/lib/domain/preferences/dashboard-layouts';
import { FINANCE_WIDGETS } from '@/lib/application/finance/dashboard-widgets';
import { requireOrganization } from '@/lib/route/organization';
import type { SaveLayoutResult } from '@/components/dashboard/dashboard-layout';

/**
 * Saves this person's Finance Dashboard layout in this organization. Membership is re-proved,
 * the layout is validated against the Finance widget registry (unknown widgets, impossible widths
 * and invalid presentations are refused), and a stale revision is a conflict, never an overwrite.
 * Nothing here reads or grants financial data.
 */
export async function saveFinanceDashboardLayout(organizationId: string, layout: unknown, expectedRevision: number): Promise<SaveLayoutResult> {
  const { db } = await requireOrganization(organizationId);
  try {
    return { revision: await saveDashboardLayout(db, { organizationId, workspace: 'finance', registry: FINANCE_WIDGETS, layout, expectedRevision }) };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, conflict: error.code === 'dashboard_layout.conflict' };
    throw error;
  }
}

export async function resetFinanceDashboardLayout(organizationId: string): Promise<{ error?: string }> {
  const { db } = await requireOrganization(organizationId);
  try { await resetDashboardLayout(db, { organizationId, workspace: 'finance' }); return {}; } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
