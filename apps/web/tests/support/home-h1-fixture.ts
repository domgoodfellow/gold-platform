import type { Db } from '@/lib/db/types';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createTask } from '@/lib/domain/tasks/tasks';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { createResourceRequirement } from '@/lib/domain/work-items/requirements';
import { createResourceAvailabilityException } from '@/lib/domain/scheduling/resource-availability';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { issueInvoice, recordPayment } from '@/lib/domain/billing/invoices';
import { todayInZone, shiftDate, zonedTimeToInstant } from '@/lib/domain/scheduling/window';

export const H1_ZONE = 'America/Toronto';
/** Synthetic records through the same commands as CRM, Work and Finance; callers own cleanup. */
export async function seedH1(db: Db, organizationId: string, kind: 'empty' | 'crm' | 'work' | 'finance' | 'mixed') {
  const date = todayInZone(H1_ZONE);
  const at = (offset: number, time = '10:00') => zonedTimeToInstant(shiftDate(date, offset), time, H1_ZONE);
  const userId = (await db.auth.getUser()).data.user!.id;
  const membershipId = (await db.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', userId).single()).data!.id;
  const ids: Record<string, string> = {};
  if (kind === 'empty') return { organizationId, membershipId, date, ids };
  const customerId = await createCustomer(db, { organizationId, name: 'North Shore Engineering and Building Services' });
  if (kind === 'crm' || kind === 'mixed') {
    for (const [key, offset, time, title] of [
      ['overdue', -1, '09:00', 'Confirm the revised maintenance proposal and access arrangements with the facilities team'],
      ['dueToday', 0, '23:00', 'Send the agreed inspection documents'],
      ['taskSeven', 7, '09:00', 'Seventh-day follow-up'], ['taskEight', 8, '09:00', 'Eighth-day follow-up'],
    ] as const) ids[key] = await createTask(db, { organizationId, customerId, title, dueAt: at(offset, time), kind: 'task', ownerMembershipId: membershipId });
  }
  if (kind === 'work' || kind === 'mixed') {
    const typeId = await createWorkItemType(db, { organizationId, name: 'Scheduled maintenance', schedulable: true });
    const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Ready' });
    ids.resource = await createResource(db, { organizationId, name: 'Alex Chen', resourceClass: 'person', membershipId });
    await createResource(db, { organizationId, name: 'Sam Rivera', resourceClass: 'person' });
    await createResourceRequirement(db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [] });
    const job = async (key: string, start: string, end: string, resourceIds: string[] = []) => {
      ids[key] = await createWorkItem(db, { organizationId, statusId, customerId, title: key === 'lateConflict' ? 'Late-day emergency inspection with an assigned technician now unavailable' : `H1 ${key}` });
      await scheduleWorkItem(db, { workItemId: ids[key], startsAt: start, endsAt: end, resourceIds });
    };
    for (let hour = 8; hour <= 14; hour++) await job(hour === 14 ? 'lateConflict' : `visit${hour}`, at(0, `${hour.toString().padStart(2,'0')}:00`), at(0, `${(hour+1).toString().padStart(2,'0')}:00`), [ids.resource]);
    await createResourceAvailabilityException(db, { resourceId: ids.resource, startsAt: at(0, '14:00'), endsAt: at(0, '15:00'), reason: 'Time off recorded after commitment' });
    await job('overnight', at(0, '23:00'), at(1, '01:00'));
    await job('continuing', at(-1, '23:00'), at(0, '01:00'));
    await job('allDay', at(0, '00:00'), at(1, '00:00'));
    await job('daySeven', at(7), at(7, '11:00'));
    await job('dayEight', at(8), at(8, '11:00'));
    ids.unscheduled = await createWorkItem(db, { organizationId, statusId, customerId, title: 'Staff and schedule the next service visit', resourceIds: [ids.resource] });
  }
  if (kind === 'finance' || kind === 'mixed') {
    const typeId = await createWorkItemType(db, { organizationId, name: 'Financial service record', schedulable: false });
    const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Open' });
    const priceBookItemId = await createPriceBookItem(db, { organizationId, name: 'Service fee', unit: 'service', unitAmountMinor: 12000 });
    for (const [key, due] of [['invoice', at(-1)], ['noDue', undefined]] as const) {
      const workItemId = await createWorkItem(db, { organizationId, statusId, customerId, title: `H1 ${key}` });
      await addPricedLine(db, { workItemId, priceBookItemId, quantity: 1 });
      ids[key] = await issueInvoice(db, { workItemId, issuedAt: at(-5), dueAt: due });
      if (key === 'invoice') {
        await recordPayment(db, { invoiceId: ids[key], amountMinor: 2000, receivedAt: at(-1) });
        await recordPayment(db, { invoiceId: ids[key], amountMinor: -500, receivedAt: at(0), note: 'Correction' });
      }
    }
  }
  return { organizationId, membershipId, date, ids };
}
