'use server';
import { revalidatePath } from 'next/cache';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';
import { saveCalendarEvent, cancelCalendarEvent } from '@/lib/domain/calendar/events';
import { localDateTimeToInstant } from '@/lib/domain/scheduling/window';
import type { WorkspaceKey } from '@/lib/navigation';

export type CalendarActionState = { error: string | null; savedId: string | null };
export async function saveEventAction(_previous: CalendarActionState, form: FormData): Promise<CalendarActionState> {
  const field = (name: string) => String(form.get(name) ?? '');
  try {
    const organizationId = field('organizationId');
    const { db, organization } = await requireOrganization(organizationId);
    const id = field('id');
    if (field('intent') === 'cancel') {
      await cancelCalendarEvent(db, { organizationId, id });
      revalidatePath(`/organizations/${organizationId}`, 'layout');
      return { error: null, savedId: id };
    }
    const savedId = await saveCalendarEvent(db, { organizationId, id: id || undefined, workspace: field('workspace') as WorkspaceKey,
      title: field('title'), notes: field('notes'), startsAt: localDateTimeToInstant(field('startsAt'), organization.timezone),
      endsAt: localDateTimeToInstant(field('endsAt'), organization.timezone) });
    revalidatePath(`/organizations/${organizationId}`, 'layout');
    return { error: null, savedId };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, savedId: null };
    throw error;
  }
}
