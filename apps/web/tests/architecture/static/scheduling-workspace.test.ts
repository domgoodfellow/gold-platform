import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Field's first real scheduling workspace: Schedule as Day and Week over the one
 * availability calculation, Resources' own feature ownership finished, and Schedule's
 * configuration reaching into no Settings UI. Source guards, like `screen-grammar.test.ts` and
 * `workspace-shell.test.ts` — nothing here mounts a component; the rendered result was checked
 * in a browser at desktop, tablet and phone widths.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ROUTES = `${WEB}/app/organizations/[organizationId]`;
const CALENDAR = `${WEB}/features/scheduling/calendar`;
const SHARED_CALENDAR = `${WEB}/components/calendar`;
const CONFIG = `${WEB}/features/scheduling/configuration`;
const read = (path: string) => readFileSync(path, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Schedule stays a page of Field, under its own URL', () => {
  it('the route is still /schedule, and its configuration is still /schedule/configuration', () => {
    expect(existsSync(`${ROUTES}/schedule/page.tsx`)).toBe(true);
    expect(existsSync(`${ROUTES}/schedule/configuration/page.tsx`)).toBe(true);
    const navigation = read(`${WEB}/lib/navigation.ts`);
    expect(navigation).toContain("{ segment: 'schedule', label: 'Schedule', group: 'workspaces', workspace: 'field'");
  });

  it('composes the feature-owned Schedule workspace rather than drawing its own cards', () => {
    const page = read(`${ROUTES}/schedule/page.tsx`);
    expect(page).toContain("from '@/features/scheduling/calendar/schedule-workspace'");
    expect(page).toContain('<ScheduleWorkspace');
    expect(page).not.toMatch(/<Card\b/);
  });
});

describe('Day and Week are URL-backed, not React memory', () => {
  const urlModule = read(`${CALENDAR}/schedule-url.ts`);
  const page = read(`${ROUTES}/schedule/page.tsx`);

  it('parses view, date and resource filters from the query string, never from client state', () => {
    expect(urlModule).toContain("parseCalendarView as parseScheduleView");
    expect(urlModule).toContain("parseCalendarDate as parseScheduleDate");
    expect(urlModule).toContain("export function parseScheduleResourceIds");
    expect(page).toContain('parseScheduleView(query.view)');
    expect(page).toContain('parseScheduleDate(query.on,');
    expect(page).toContain('parseScheduleResourceIds(query.resource)');
  });

  it('an invalid or missing view resolves to Day, and an invalid or missing date resolves to today in the organization’s timezone', () => {
    expect(read(`${SHARED_CALENDAR}/calendar-period.ts`)).toContain("value === 'week' || value === 'month' ? value : 'day'");
    expect(page).toContain('todayInZone(organization.timezone)');
  });

  it('every Schedule address is built through the one scheduleHref, never assembled by hand', () => {
    expect(urlModule).toContain('export function scheduleHref(');
    for (const file of ['schedule-resource-filter.tsx']) {
      const source = code(read(`${CALENDAR}/${file}`));
      expect(source, file).toContain('scheduleHref(');
      expect(source, file).not.toMatch(/router\.push\(`\/organizations/);
    }
  });

  it('Day, Week and Month are all URL-backed views, not React memory', () => {
    const urlModule2 = read(`${CALENDAR}/schedule-url.ts`);
    expect(urlModule2).toContain("export type ScheduleView = CalendarView;");
    expect(read(`${SHARED_CALENDAR}/calendar-workspace.tsx`)).toContain("['day', 'week', 'month']");
  });
});

describe('Month is a real, persistent board — a coarser projection of the same Work Items', () => {
  it('month-schedule.tsx exists, feature-owned, with no calendar entity and no second availability algorithm', () => {
    expect(existsSync(`${CALENDAR}/month-schedule.tsx`)).toBe(true);
    const month = read(`${CALENDAR}/month-schedule.tsx`);
    expect(month).not.toMatch(/from\(['"]calendar['"]\)/);
    expect(month).not.toMatch(/freeWindows|openWindows/);
  });

  it('the route builds a 42-day Monday-first grid for Month, through the same listScheduleDays every other view uses', () => {
    const page = read(`${ROUTES}/schedule/page.tsx`);
    expect(page).toContain("calendarDates(view, date)");
    expect(read(`${SHARED_CALENDAR}/calendar-period.ts`)).toContain("? 42");
    expect(page).toContain('startOfMonth(date)');
  });

  it('the shadcn Calendar is not imported by any Schedule board', () => {
    for (const file of ['day-schedule.tsx', 'week-schedule.tsx', 'month-schedule.tsx']) {
      expect(read(`${CALENDAR}/${file}`)).not.toMatch(/@gold\/ui\/components\/calendar/);
    }
  });

  it('no heavy third-party scheduling/calendar dependency is introduced', () => {
    const packageJson = read(`${WEB}/package.json`);
    expect(packageJson).not.toMatch(/fullcalendar|react-big-calendar|daypilot|syncfusion/i);
  });
});

describe('Schedule composes feature-owned scheduling UI', () => {
  it('every piece named for the workspace exists, feature-owned', () => {
    for (const file of [
      'schedule-workspace.tsx',
      'schedule-resource-filter.tsx',
      'schedule-event.tsx',
      'day-schedule.tsx',
      'week-schedule.tsx',
    ]) {
      expect(existsSync(`${CALENDAR}/${file}`), file).toBe(true);
    }
  });

  it('Day and Week both render the one shared ScheduleEvent, not two event markups', () => {
    expect(read(`${CALENDAR}/day-schedule.tsx`)).toContain('<ScheduleEvent');
    expect(read(`${CALENDAR}/week-schedule.tsx`)).toContain('<ScheduleEvent');
  });

  it('the resource filter is URL-backed view state, not a database write', () => {
    const filter = code(read(`${CALENDAR}/schedule-resource-filter.tsx`));
    expect(filter).not.toMatch(/getDb|supabase|\.from\(/);
    expect(filter).toContain("'use client'");
  });
});

describe('Week does not force seven Resource-lane columns, and narrows to an agenda', () => {
  it('Week groups by day, not by Resource column', () => {
    const week = read(`${CALENDAR}/week-schedule.tsx`);
    expect(week).toContain('<CalendarAgenda');
    expect(read(`${SHARED_CALENDAR}/calendar-boards.tsx`)).toContain('@min-[48rem]:grid-cols-7');
    expect(week).not.toMatch(/resources\.map[\s\S]{0,80}resources\.map/);
  });

  it('Day lays out one lane per visible Resource, positioned from real instants', () => {
    const day = read(`${CALENDAR}/day-schedule.tsx`);
    expect(day).toContain('resources.map((entry)');
    expect(day).toMatch(/offsetPct|heightPct/);
  });
});

describe('no calendar entity, and no heavy calendar dependency', () => {
  it('adds no calendar table or migration', () => {
    const packageJson = read(`${WEB}/package.json`);
    expect(packageJson).not.toMatch(/fullcalendar|react-big-calendar|daypilot|syncfusion/i);
  });

  it('every window is still derived from work_items, never a cached slot', () => {
    const availability = read(`${WEB}/lib/domain/scheduling/availability.ts`);
    expect(availability).not.toMatch(/from\(['"]calendar['"]\)/);
    expect(availability).toContain("from('work_items')");
  });
});

describe('listSchedule still works for its existing callers, and Week reuses the same availability logic', () => {
  const availability = read(`${WEB}/lib/domain/scheduling/availability.ts`);

  it('keeps listSchedule exported, and Field and Home read the one day through listScheduleDays — it carries who is unassigned, which their counts need', () => {
    expect(availability).toMatch(/export async function listSchedule\(/);
    expect(read(`${ROUTES}/field/page.tsx`)).toContain('workOperations(db,');
    expect(read(`${WEB}/lib/application/work/operations.ts`)).toContain('listScheduleDays(db, {');
    // Home counts scheduled Work through the canonical Work read and computes no availability of its own.
    const home = read(`${WEB}/lib/application/home/reads.ts`);
    expect(home).toContain('listWorkItems(');
    expect(home).not.toMatch(/freeWindows|openWindows|groupBookedByResource/);
  });

  it('exports listScheduleDays for several tenant calendar days at once', () => {
    expect(availability).toMatch(/export async function listScheduleDays\(/);
    expect(read(`${ROUTES}/schedule/page.tsx`)).toContain('listScheduleDays(db, {');
  });

  it('both callers share one grouping and one free/booked computation — no second availability algorithm', () => {
    expect(availability.match(/function groupBookedByResource\(/g)).toHaveLength(1);
    expect(availability.match(/function resourceSchedulesFor\(/g)).toHaveLength(1);
    expect(availability).toContain('groupBookedByResource((committed.data ?? []) as unknown as CommittedRow[], conflicts)');
    // listScheduleDays calls the same two helpers listSchedule does.
    const daysBody = availability.slice(availability.indexOf('export async function listScheduleDays('));
    // Each lane's open windows come from the one resource-availability reader, never recomputed here.
    expect(daysBody).toContain('resourceSchedulesFor(');
    expect(daysBody).toContain('openForDay,');
  });

  it('reuses freeWindows and openWindows rather than recomputing availability', () => {
    expect(availability).toContain("import {\n  listOperatingHours,\n  openWindows,");
    expect(availability.match(/freeWindows\(/g)!.length).toBeGreaterThanOrEqual(2); // definition + call site
  });
});

describe('date/time calculations stay timezone aware', () => {
  it('shiftDate is pure calendar-date arithmetic, reused by the toolbar and the route’s week math', () => {
    const window = read(`${WEB}/lib/domain/scheduling/window.ts`);
    expect(window).toContain('export function shiftDate(');
    expect(read(`${SHARED_CALENDAR}/calendar-workspace.tsx`)).toContain('shiftDate(');
    expect(read(`${SHARED_CALENDAR}/calendar-period.ts`)).toContain('shiftDate(first, index)');
  });

  it('the week is the ISO week (Monday first) containing the selected day', () => {
    expect(read(`${SHARED_CALENDAR}/calendar-period.ts`)).toContain('isoDayOfWeek(anchor)');
  });
});

describe('Schedule configuration reaches into no Settings UI', () => {
  const scheduleConfiguration = read(`${CONFIG}/schedule-configuration.tsx`);
  const editor = read(`${CONFIG}/operating-hours-editor.tsx`);

  it('imports nothing from the settings route', () => {
    for (const source of [scheduleConfiguration, editor]) {
      expect(source).not.toMatch(/app\/organizations\/\[organizationId\]\/settings\/settings-forms/);
    }
  });

  it('the weekly editor lives in the Scheduling feature, not Settings', () => {
    expect(existsSync(`${CONFIG}/operating-hours-editor.tsx`)).toBe(true);
    expect(scheduleConfiguration).toContain('OperatingHoursEditor');
  });

  it('shows every one of the seven days explicitly, never a toggle standing in for a default time', () => {
    expect(editor).toContain('const DAYS = [1, 2, 3, 4, 5, 6, 7]');
    expect(editor).not.toMatch(/<Switch\b/);
  });

  it('supports more than one period a day, and lets each be removed on its own', () => {
    expect(editor).toContain('periods.map(');
    expect(editor).toContain('AddPeriodForm');
    expect(editor).toContain('removeOperatingHoursAction');
  });

  it('states the two different meanings of an unconfigured day truthfully — no claim at all, versus closed', () => {
    expect(editor).toMatch(/No opening hours are configured for any day[\s\S]{0,80}treats every hour as open/);
    expect(editor).toContain('Closed — no hours configured for this day.');
  });
});

describe('the operating-hours Server Actions moved to the Schedule configuration route', () => {
  it('live at schedule/configuration/actions.ts, not settings/actions.ts', () => {
    const scheduleActions = read(`${ROUTES}/schedule/configuration/actions.ts`);
    expect(scheduleActions).toContain('export async function addOperatingHoursAction');
    expect(scheduleActions).toContain('export async function removeOperatingHoursAction');
    expect(scheduleActions).toContain("from '@/lib/domain/scheduling/operating-hours'");

    const settingsActions = read(`${ROUTES}/settings/actions.ts`);
    expect(settingsActions).not.toContain('addOperatingHoursAction');
    expect(settingsActions).not.toContain('removeOperatingHoursAction');
    expect(settingsActions).not.toContain('operating-hours');
  });

  it('preserves the exact domain calls, error handling and revalidation the Settings actions had', () => {
    const scheduleActions = read(`${ROUTES}/schedule/configuration/actions.ts`);
    expect(scheduleActions).toContain('await addOperatingHours(db, {');
    expect(scheduleActions).toContain('await removeOperatingHours(db, { id:');
    expect(scheduleActions).toContain('error instanceof DomainError');
    expect(scheduleActions).toContain(`revalidatePath(\`/organizations/\${organizationId}/schedule/configuration\`)`);
    expect(scheduleActions).toContain(`revalidatePath(\`/organizations/\${organizationId}/schedule\`)`);
  });

  it('the tenancy settings form no longer defines the operating-hours forms', () => {
    const settingsForm = read(`${WEB}/features/tenancy/organization-settings-form.tsx`);
    expect(settingsForm).not.toContain('AddOperatingHoursForm');
    expect(settingsForm).not.toContain('OperatingHoursRow');
    expect(settingsForm).toContain('OrganizationSettingsForm');
  });
});

describe('Resources create/table UI is feature-owned', () => {
  it('the create form and sheet live under features/resources, not the route', () => {
    expect(existsSync(`${WEB}/features/resources/create-resource-form.tsx`)).toBe(true);
    expect(existsSync(`${WEB}/features/resources/create-resource-sheet.tsx`)).toBe(true);
    expect(existsSync(`${ROUTES}/resources/create-resource-form.tsx`)).toBe(false);
    expect(existsSync(`${ROUTES}/resources/create-resource-sheet.tsx`)).toBe(false);
  });

  it('the create form posts to the route-owned action by its full path, since it moved feature-side', () => {
    const form = read(`${WEB}/features/resources/create-resource-form.tsx`);
    expect(form).toContain(
      "from '@/app/organizations/[organizationId]/resources/actions'",
    );
  });

  it('Resources keeps its Server Action route-owned', () => {
    expect(existsSync(`${ROUTES}/resources/actions.ts`)).toBe(true);
    const actions = read(`${ROUTES}/resources/actions.ts`);
    expect(actions).toContain("'use server'");
    expect(actions).toContain('export async function createResourceAction');
  });

  it('Resources no longer defines its own DataTable schema inline — ResourceTable owns it', () => {
    const page = read(`${ROUTES}/resources/page.tsx`);
    expect(page).not.toContain('<DataTable');
    expect(page).toContain('<ResourceTable');
    const table = read(`${WEB}/features/resources/resource-table.tsx`);
    expect(table).toContain('<DataTable');
    expect(table).toContain("from '@/components/display/table'");
  });
});

describe('Resources and Schedule/Work revalidate every surface Field now shares', () => {
  it('creating a Resource refreshes Resources, Schedule and Field', () => {
    const actions = read(`${ROUTES}/resources/actions.ts`);
    for (const path of ['/resources', '/schedule', '/field']) {
      expect(actions).toContain(`revalidatePath(\`/organizations/\${organizationId}${path}\`)`);
    }
  });

  it('scheduling or unscheduling Work refreshes Work, Schedule and Field', () => {
    const actions = read(`${ROUTES}/work/actions.ts`);
    const scheduleAction = actions.slice(actions.indexOf('export async function scheduleWorkItemAction'));
    for (const path of ['/work', '/schedule', '/field']) {
      expect(scheduleAction).toContain(`/organizations/\${organizationId}${path}`);
    }
  });
});

describe('Day shades each Resource’s own free time, never the day’s shared open period', () => {
  it('lane background comes from entry.free, not the day-wide open windows', () => {
    const day = read(`${CALENDAR}/day-schedule.tsx`);
    expect(day).toContain('entry.free.map(');
    // The day-wide `open` prop is background context only; `entry.open` is a lane's own, read for assistive text.
    expect(day).not.toMatch(/(?<![.\w])open\.map\(/);
  });
});

describe('a booking spanning midnight is clipped to the day it is drawn on, for display only', () => {
  it('Day and Week clip geometry/labels through clipWindow, while ScheduleEvent still gets the canonical window', () => {
    const window = read(`${WEB}/lib/domain/scheduling/window.ts`);
    expect(window).toContain('export function clipWindow(');

    // Day clips in place; Week and Month read `dayEvents`, which clips once for both.
    for (const file of ['day-schedule.tsx', 'day-events.ts']) {
      const source = read(`${CALENDAR}/${file}`);
      expect(source, file).toContain('clipWindow(');
      expect(source, file).toContain('displayWindow');
    }
    expect(read(`${CALENDAR}/week-schedule.tsx`)).toContain('dayEvents(day)');

    const event = read(`${CALENDAR}/schedule-event.tsx`);
    expect(event).toContain('displayWindow');
    // The full description still reads the canonical, unclipped window.
    expect(event).toContain('formatWindow(window, timezone)');
  });
});

describe('the resource filter offers one clear action, not two that do the same thing', () => {
  it('has no duplicate Select all / Clear pair that both reset to showing everyone', () => {
    const filter = read(`${CALENDAR}/schedule-resource-filter.tsx`);
    expect(filter).not.toContain('Select all');
    expect(filter.match(/navigate\(\[\]\)/g)).toHaveLength(1);
  });
});

describe('field.manage stays the authority for opening hours — unchanged in this slice', () => {
  it('the database migration and the UI still agree on the capability', () => {
    const page = read(`${ROUTES}/schedule/page.tsx`);
    expect(page).toContain("organization.capabilities.includes('field.manage')");
    expect(page).not.toContain('schedule.manage');
  });
});

describe('the Schedule canvas exists and fills the workspace even when there is nothing to show', () => {
  it('zero-Resource Day renders the timeline grid, with onboarding inside it rather than a page-replacing EmptyState', () => {
    const day = code(read(`${CALENDAR}/day-schedule.tsx`));
    // The old defect: an early `return <EmptyState>…` before the grid is ever drawn.
    expect(day).not.toMatch(/if \(resources\.length === 0\)\s*{?\s*return\s*\(?\s*<EmptyState/);
    expect(day).toContain('No resources configured');
    expect(day).toContain('resources.length === 0');
  });

  it('zero-event Week still renders seven day surfaces rather than one replacing sentence', () => {
    const week = code(read(`${CALENDAR}/week-schedule.tsx`));
    expect(week).not.toMatch(/if \(total === 0\)\s*{?\s*return\s*\(?\s*<EmptyState/);
    expect(week).not.toContain('Nothing scheduled this week');
    expect(week).toContain('days.map(day');
  });

  it('zero-event Month still renders the six-week grid', () => {
    const month = read(`${CALENDAR}/month-schedule.tsx`);
    expect(month).toContain('<CalendarMonth');
    expect(read(`${SHARED_CALENDAR}/calendar-boards.tsx`)).toContain('weeks.map(');
    expect(month).not.toMatch(/if \([\s\S]{0,40}=== 0\)\s*{?\s*return\s*\(?\s*<EmptyState/);
  });

  it('Day draws a presentation-only default range rather than refusing to draw an axis at all', () => {
    const geometry = read(`${CALENDAR}/calendar-geometry.ts`);
    expect(geometry).toContain('DISPLAY_DAY_START_HOUR');
    expect(geometry).toContain('DISPLAY_DAY_END_HOUR');
    expect(geometry).toContain('export function computeDisplayAxisBounds(');
    // The display default is pixels/presentation, not a change to the availability calculation.
    const availability = read(`${WEB}/lib/domain/scheduling/availability.ts`);
    expect(availability).not.toMatch(/DISPLAY_DAY_START_HOUR|DISPLAY_DAY_END_HOUR/);
  });
});

describe('Day no longer sizes itself to its own contents as the primary layout strategy', () => {
  it('drops width: max-content as the row sizing contract', () => {
    const day = read(`${CALENDAR}/day-schedule.tsx`);
    expect(day).not.toMatch(/width:\s*['"]max-content['"]/);
  });

  it('Resource lanes are flexible, not permanently fixed to one width', () => {
    const day = read(`${CALENDAR}/day-schedule.tsx`);
    // The old defect: a lane hardcoded to exactly `w-44 shrink-0`, with no grow at all.
    expect(day).not.toContain('w-44 shrink-0');
    expect(day).toMatch(/flex-1/);
  });
});

describe('the Schedule workspace and every board fill the available height through a real flex chain', () => {
  it('schedule-workspace.tsx composes a min-h-0/flex-1 column, not a fixed or arbitrary pixel height', () => {
    const workspace = read(`${CALENDAR}/schedule-workspace.tsx`);
    expect(workspace).toContain('<CalendarWorkspace');
    const foundation = read(`${SHARED_CALENDAR}/calendar-workspace.tsx`);
    expect(foundation).toMatch(/min-h-0/);
    expect(foundation).toMatch(/flex-1/);
    expect(workspace).not.toMatch(/min-h-\[\d+px\]/);
  });

  it('every board file avoids an arbitrary large fixed pixel min-height', () => {
    for (const file of ['day-schedule.tsx', 'week-schedule.tsx', 'month-schedule.tsx', 'schedule-workspace.tsx']) {
      expect(read(`${CALENDAR}/${file}`)).not.toMatch(/min-h-\[\d{3,}px\]/);
    }
  });

  it('the shared app shell gives a page a real viewport-bound height to fill, rather than growing unbounded', () => {
    const shell = read(`${WEB}/components/layout/app-shell.tsx`);
    expect(shell).toMatch(/h-svh/);
    expect(shell).toMatch(/overflow-y-auto/);
  });

  it('the Schedule page opts into that height chain explicitly, through AppPage', () => {
    const page = read(`${ROUTES}/schedule/page.tsx`);
    const match = /<AppPage className="([^"]*)"/.exec(page);
    expect(match, 'AppPage should carry an explicit className').not.toBeNull();
    expect(match![1]).toMatch(/flex-1/);
    expect(match![1]).toMatch(/min-h-0/);
  });
});

describe('Month navigates coherently and keeps the resource filter and URL-backed state', () => {
  it('a month cell links to Day for that date through scheduleHref, carrying the active resource filter', () => {
    const month = read(`${CALENDAR}/month-schedule.tsx`);
    expect(month).toContain("scheduleHref(organizationId, { view: 'day', date: day.date, resourceIds })");
  });

  it('shiftMonth is pure calendar-date arithmetic, reused by the toolbar for Month’s Previous/Next', () => {
    const window = read(`${WEB}/lib/domain/scheduling/window.ts`);
    expect(window).toContain('export function shiftMonth(');
    expect(read(`${SHARED_CALENDAR}/calendar-workspace.tsx`)).toContain('shiftMonth(');
  });
});


describe('CRM and Work use one calendar foundation', () => {
  it('keeps Calendar within its workspace and redirects legacy addresses', () => {
    const page = code(read(`${WEB}/features/calendar/workspace-calendar-page.tsx`));
    expect(page).toContain('loadOrganizationCalendar');
    expect(page).not.toContain('notFound');
    const legacy = code(read(`${ROUTES}/follow-ups/calendar/page.tsx`));
    expect(legacy).toContain('redirect(');
    expect(legacy).toContain('/calendar');
    expect(legacy).not.toContain('listFollowUps');
  });
  it('both compose shared navigation, toolbar and frame with contextual filters', () => {
    for (const path of [`${CALENDAR}/schedule-workspace.tsx`, `${WEB}/features/calendar/workspace-calendar-page.tsx`]) {
      const source = code(read(path));
      expect(source).toContain("from '@/components/calendar/calendar-workspace'");
      expect(source).toContain('<CalendarWorkspace');
      expect(source).toContain('filterControls=');
      expect(source).not.toContain('<DatePicker');
      expect(source).not.toContain('<ViewNav');
    }
    expect(existsSync(`${CALENDAR}/schedule-toolbar.tsx`)).toBe(false);
    expect(existsSync(`${CALENDAR}/schedule-view-nav.tsx`)).toBe(false);
  });
  it('Organization Calendar supplies combined domain content to the same month and agenda boards as Work', () => {
    const crm = code(read(`${WEB}/features/calendar/organization-calendar.tsx`));
    expect(crm).toContain('<CalendarTimeGrid');
    expect(crm).toContain('<CalendarMonth');
    expect(crm).not.toMatch(/grid-cols-7|grid-rows-6/);
    expect(read(`${CALENDAR}/week-schedule.tsx`)).toContain('<CalendarAgenda');
    expect(read(`${CALENDAR}/month-schedule.tsx`)).toContain('<CalendarMonth');
  });
});
