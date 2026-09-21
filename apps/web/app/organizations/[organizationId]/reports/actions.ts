'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  createDashboard,
  deleteDashboard,
  pinReport,
  unpinReport,
} from '@/lib/domain/reporting/dashboards';
import {
  deleteReportDefinition,
  saveReportDefinition,
  setReportRoles,
} from '@/lib/domain/reporting/definitions';
import type { Grouping, Measure, PeriodPreset } from '@/lib/domain/reporting/shape';
import { requireOrganization } from '@/lib/route/organization';

export type ReportState = { error: string | null };

/**
 * Saving, deleting and sharing a report.
 *
 * **Nothing here decides anything.** Every refusal below comes from a policy — `report.manage`
 * on the insert, the composite keys on a filter naming another business's customer, the unique
 * index on a name already used. These actions read a form and call the domain layer, and the
 * `try` blocks exist to turn a `DomainError` into a sentence rather than to make a judgement.
 *
 * An empty string is null on purpose: a `<select>` with nothing chosen posts `""`, and a filter
 * of `""` is not a uuid — it means *any*.
 */
const orNull = (value: FormDataEntryValue | null) => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
};

export async function saveReportAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await saveReportDefinition(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      measure: String(formData.get('measure') ?? '') as Measure,
      grouping: String(formData.get('grouping') ?? '') as Grouping,
      period: String(formData.get('period') ?? '') as PeriodPreset,
      filters: {
        customerId: orNull(formData.get('customer')),
        resourceId: orNull(formData.get('resource')),
        locationId: orNull(formData.get('location')),
      },
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/reports`);
  return { error: null };
}

export async function deleteReportAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await deleteReportDefinition(db, { id: String(formData.get('reportId') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/reports`);
  return { error: null };
}

export async function setReportRolesAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await setReportRoles(db, {
      organizationId,
      reportId: String(formData.get('reportId') ?? ''),
      // Every checked box, and none is a real answer: a report shared with nobody is one only
      // its author and whoever manages reports can see, which is what an unshared draft is.
      roleIds: formData.getAll('roleId').map(String).filter(Boolean),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/reports`);
  return { error: null };
}

export async function createDashboardAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await createDashboard(db, { organizationId, name: String(formData.get('name') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/reports`);
  return { error: null };
}

export async function deleteDashboardAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await deleteDashboard(db, { id: String(formData.get('dashboardId') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/reports`);
  return { error: null };
}

/**
 * Put a report on a dashboard, or take it off.
 *
 * One action for both, because the form that calls it is one row with a checkbox: what a person
 * is doing is saying whether this report belongs on this dashboard, and splitting that into two
 * verbs would make the screen ask a question nobody has.
 */
export async function setPinAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const dashboardId = String(formData.get('dashboardId') ?? '');
  const reportId = String(formData.get('reportId') ?? '');
  const pinned = formData.get('pinned') === 'yes';

  try {
    if (pinned) {
      await unpinReport(db, { organizationId, dashboardId, reportId });
    } else {
      await pinReport(db, { organizationId, dashboardId, reportId });
    }
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/reports`);
  return { error: null };
}
