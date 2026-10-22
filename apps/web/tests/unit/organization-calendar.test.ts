import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { counted } from '@/lib/domain/counted';
import type { CrmTask } from '@/lib/domain/tasks/tasks';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import { calendarEvents, eventsOnDate, loadOrganizationCalendar, parseCalendarSource } from '@/lib/application/calendar/organization-calendar';

const reads = vi.hoisted(() => ({ available: vi.fn(), followUps: vi.fn(), work: vi.fn(), members: vi.fn(), events: vi.fn() }));
vi.mock('@/lib/application/crm/follow-ups', () => ({ followUpsAvailable: reads.available }));
vi.mock('@/lib/domain/tasks/tasks', () => ({ listTasks: reads.followUps }));
vi.mock('@/lib/domain/work-items/work-items', () => ({ listWorkItems: reads.work }));
vi.mock('@/lib/domain/calendar/events', () => ({ listCalendarEvents: reads.events }));
vi.mock('@/lib/domain/tenancy/members', () => ({ listMembers: reads.members }));

const followUp = { id: 'same-id', title: 'Discuss proposal', dueAt: '2026-11-01T05:30:00Z', kind: 'meeting',
  status: 'open', customerName: 'Customer', opportunityTitle: 'Proposal', ownerName: 'Owner' } as CrmTask;
const work = { id: 'same-id', title: 'Installation', window: { startsAt: '2026-11-01T03:00:00Z', endsAt: '2026-11-01T07:00:00Z' },
  status: { label: 'Booked' }, resources: [{ id: 'r1', label: 'One' }, { id: 'r2', label: 'Two' }], customer: { label: 'Customer' } } as WorkItem;
const input = { organizationId: 'org', source: 'all' as const, within: { startsAt: '2026-11-01T04:00:00Z', endsAt: '2026-11-02T05:00:00Z' } };
const db = {} as Db;
beforeEach(() => {
  vi.resetAllMocks();
  reads.available.mockResolvedValue(true);
  reads.followUps.mockResolvedValue(counted([followUp], 1));
  reads.work.mockResolvedValue(counted([work], 1));
  reads.members.mockResolvedValue([]);
  reads.events.mockResolvedValue(counted([], 0));
});

describe('shared organization calendar', () => {
  it('combines sources in time order without duplicating work for its assigned resources', () => {
    const events = calendarEvents([followUp], [work]);
    expect(events.map(event => event.key)).toEqual(['work:same-id', 'follow-up:same-id']);
    expect(events[0].context).toBe('Customer · One · Two');
  });
  it('projects overnight work across local days and treats midnight endings as exclusive through DST', () => {
    const events = calendarEvents([followUp], [work]);
    expect(eventsOnDate(events, '2026-10-31', 'America/Toronto').map(e => e.source)).toEqual(['work']);
    expect(eventsOnDate(events, '2026-11-01', 'America/Toronto')).toHaveLength(2);
    const midnight = { ...work, window: { startsAt: '2026-11-01T03:00:00Z', endsAt: '2026-11-01T04:00:00Z' } };
    expect(eventsOnDate(calendarEvents([], [midnight]), '2026-11-01', 'America/Toronto')).toEqual([]);
  });
  it('reads both canonical sources within the organization and selected period; owner scopes only CRM', async () => {
    const result = await loadOrganizationCalendar(db, { ...input, owner: 'unassigned' });
    expect(result.events).toHaveLength(2);
    expect(reads.followUps).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: 'org', ownerMembershipId: null,
      from: input.within.startsAt, before: input.within.endsAt }));
    expect(reads.work).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: 'org', within: input.within, scheduled: true }));
    expect(reads.work.mock.calls[0][1]).not.toHaveProperty('ownerMembershipId');
  });
  it('keeps scheduled work available with follow-ups disabled and never reads disabled CRM records', async () => {
    reads.available.mockResolvedValue(false);
    const result = await loadOrganizationCalendar(db, input);
    expect(result.events.map(e => e.source)).toEqual(['work']);
    expect(reads.followUps).not.toHaveBeenCalled();
    expect(reads.members).not.toHaveBeenCalled();
  });
  it('keeps a successful source visible and reports a failed source instead of implying an empty calendar', async () => {
    reads.followUps.mockRejectedValue(new Error('read failed'));
    const result = await loadOrganizationCalendar(db, input);
    expect(result.events.map(e => e.source)).toEqual(['work']);
    expect(result.notices).toContain('Follow-ups are unavailable. Other calendar sources may still be shown.');
  });
  it('honors source selection and discloses truncated or unknown totals', async () => {
    reads.work.mockResolvedValue(counted([work], 501));
    const result = await loadOrganizationCalendar(db, { ...input, source: 'work' });
    expect(reads.available).not.toHaveBeenCalled();
    expect(result.notices).toHaveLength(1);
    expect(parseCalendarSource('unknown')).toBe('all');
    expect(parseCalendarSource('follow-ups')).toBe('follow-ups');
  });
});
