import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { counted } from '@/lib/domain/counted';
import { WORKSPACES, type WorkspaceKey } from '@/lib/navigation';
import type { Window } from '@/lib/domain/scheduling/window';

export type CalendarEvent = {
  id: string; organizationId: string; workspace: WorkspaceKey; title: string; startsAt: string; endsAt: string;
  notes: string | null; createdBy: string; status: 'scheduled' | 'cancelled';
};
export type CalendarEventInput = {
  organizationId: string; workspace: WorkspaceKey; title: string; startsAt: string; endsAt: string; notes?: string;
};
function failure(message: string): never { throw new DomainError(message, 'calendar.failed'); }
function values(input: CalendarEventInput) {
  if (!WORKSPACES.some(workspace => workspace.key === input.workspace)) failure('Choose a workspace.');
  const title = input.title.trim();
  if (!title || title.length > 200) failure('Enter a title up to 200 characters.');
  if ((input.notes?.length ?? 0) > 10000) failure('Notes must be 10,000 characters or fewer.');
  const start = Date.parse(input.startsAt), end = Date.parse(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) failure('End must be after start.');
  return { title, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), notes: input.notes?.trim() || null };
}
export async function listCalendarEvents(db: Db, input: { organizationId: string; workspace?: WorkspaceKey; within: Window }) {
  let query = db.from('calendar_events').select('*', { count: 'exact' }).eq('organization_id', input.organizationId)
    .eq('status', 'scheduled').lt('starts_at', input.within.endsAt).gt('ends_at', input.within.startsAt);
  if (input.workspace) query = query.eq('workspace', input.workspace);
  const { data, error, count } = await query.order('starts_at').order('id').limit(500);
  if (error) failure('Calendar events could not be loaded.');
  return counted((data ?? []).map(row => ({ id: row.id, organizationId: row.organization_id, workspace: row.workspace as WorkspaceKey,
    title: row.title, startsAt: row.starts_at, endsAt: row.ends_at, notes: row.notes, createdBy: row.created_by, status: row.status as CalendarEvent['status'] })), count);
}
export async function saveCalendarEvent(db: Db, input: CalendarEventInput & { id?: string }) {
  const actor = await requireActor(db);
  const fields = values(input);
  const query = input.id
    ? db.from('calendar_events').update(fields).eq('organization_id', input.organizationId).eq('id', input.id).eq('status', 'scheduled')
    : db.from('calendar_events').insert({ ...fields, organization_id: input.organizationId, workspace: input.workspace, created_by: actor.id });
  const { data, error } = await query.select('id').single();
  if (error || !data) failure('This event could not be saved. Check your access and try again.');
  return data.id;
}
export async function cancelCalendarEvent(db: Db, input: { organizationId: string; id: string }) {
  await requireActor(db);
  const { data, error } = await db.from('calendar_events').update({ status: 'cancelled' })
    .eq('organization_id', input.organizationId).eq('id', input.id).select('id').single();
  if (error || !data) failure('This event could not be cancelled. Check your access and try again.');
}
