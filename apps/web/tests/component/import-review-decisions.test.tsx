// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportRunDetail, importChanges, matchDescription, summarizeStaging } from '@/features/integrations/imports/import-run-detail';
import type { ImportRun, StagingRow } from '@/lib/domain/integrations/import-runs';
import type { ContactSummary } from '@/lib/domain/contacts/contacts';
import { chooseOption, fieldValue, optionLabels } from '../support/select-field';

const actions = vi.hoisted(() => ({ decide: vi.fn(), skip: vi.fn(async () => ({ error: null })), apply: vi.fn(async () => ({ error: null })), resume: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/app/organizations/[organizationId]/library/imports/[runId]/actions', () => ({
  decideImportRowAction: actions.decide, skipUndecidedImportRowsAction: actions.skip, applyImportRunAction: actions.apply, resumeImportStagingAction: actions.resume,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const run: ImportRun = { id: 'run', resourceId: 'file', mappingId: 'map', connectorKey: 'file_upload', status: 'pending', rowsSeen: 4, rowsCreated: 0, rowsUpdated: 0, rowsSkipped: 0, rowsFailed: 0, startedAt: '2026-11-13T10:00:00Z', finishedAt: null };
const row = (id: string, name: string, patch: Partial<StagingRow>): StagingRow => ({
  id, sourceRecordKey: `key:${id}`, raw: {}, normalized: { name }, validationErrors: [], proposedAction: 'create', matchedCustomerId: null,
  status: 'ready', matchReason: null, candidateIds: [], decided: false, ...patch,
});
const contacts = new Map<string, ContactSummary>([
  ['desk', { id: 'desk', name: 'Front Desk', email: null, phone: '+14165550100' }],
  ['eve', { id: 'eve', name: 'Eve Original', email: 'eve@example.test', phone: null }],
  ['linked', { id: 'linked', name: 'Linked Person', email: null, phone: null }],
]);
const rows = [
  row('jordan', 'Jordan', { status: 'review', proposedAction: 'review', matchReason: 'phone', candidateIds: ['desk'] }),
  row('eve-row', 'Eve Renamed', { proposedAction: 'update', matchedCustomerId: 'eve', matchReason: 'email' }),
  row('linked-row', 'Linked', { proposedAction: 'update', matchedCustomerId: 'linked', matchReason: 'source' }),
  row('new', 'Brand New', {}),
];
function renderRun(list = rows) {
  return render(<ImportRunDetail organizationId="org" runId="run" run={run} rows={list} summary={summarizeStaging(list)} readyCount={list.filter(r => r.status === 'ready').length} contacts={contacts} />);
}
// The shared table draws each row twice, as a table row and as a phone card; the first is enough here.
const decisionFor = (name: string) => screen.getAllByRole('combobox', { name: `Decision for ${name}` })[0];

describe('import review decisions', () => {
  it('names why each row matched and holds Import until every row needing review is decided', () => {
    renderRun();
    expect(screen.getAllByText('Same phone number as Front Desk')[0]).toBeVisible();
    expect(screen.getAllByText('Same email as Eve Original')[0]).toBeVisible();
    expect(screen.getAllByText('Linked to Linked Person by source ID')[0]).toBeVisible();
    const staged = screen.getByLabelText('Staged changes');
    expect(within(staged).getByText('Needs review').nextElementSibling).toHaveTextContent('1');
    expect(within(staged).getByText('New contacts').nextElementSibling).toHaveTextContent('1');
    expect(within(staged).getByText('Updates to existing contacts').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Decide the 1 row marked Needs review before importing.')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Import \d+ contacts?$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip 1 row needing review' })).toBeEnabled();
  });

  it('offers Create only where a new contact could be the same person, never for an email or source match', async () => {
    renderRun();
    expect(await optionLabels(decisionFor('Jordan'))).toEqual(['Create new contact', 'Update Front Desk', 'Skip']);
    expect(await optionLabels(decisionFor('Eve Renamed'))).toEqual(['Update Eve Original', 'Skip']);
    expect(await optionLabels(decisionFor('Linked'))).toEqual(['Update Linked Person', 'Skip']);
    expect(await optionLabels(decisionFor('Brand New'))).toEqual(['Create new contact', 'Skip']);
  });

  it('saves a decision as soon as it is chosen, and puts it back with the reason when it is refused', async () => {
    actions.decide.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: 'Another row in this import already updates that contact.' });
    renderRun();
    await chooseOption(decisionFor('Jordan'), 'Update Front Desk');
    await waitFor(() => expect(actions.decide).toHaveBeenCalledWith('org', 'run', 'jordan', 'update', 'desk'));
    expect(refresh).toHaveBeenCalled();
    await chooseOption(decisionFor('Brand New'), 'Skip');
    await waitFor(() => expect(actions.decide).toHaveBeenLastCalledWith('org', 'run', 'new', 'skip', null));
    expect((await screen.findAllByText('Another row in this import already updates that contact.'))[0]).toBeVisible();
    await waitFor(() => expect(fieldValue(decisionFor('Brand New'))).toBe('create'));
  });

  it('lets Import go ahead once nothing needs review', () => {
    renderRun(rows.map(r => r.id === 'jordan' ? { ...r, status: 'ignored', proposedAction: 'skip', decided: true } : r));
    expect(screen.queryByText(/Needs review before importing/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Import \d+ contacts?$/ })).toBeEnabled();
  });

describe('what an Update would change', () => {
  const current = { id: 'eve', name: 'Eve Original', email: 'eve@example.test', phone: null, lifecycle: 'lead' as const, leadTemperature: 'unrated' as const, contactType: 'person' as const, custom: { industry: 'Retail' } };
  it('lists each mapped value that differs as current and incoming, and nothing an Update would keep', () => {
    const update = row('eve-row', 'Eve Renamed', { proposedAction: 'update', matchedCustomerId: 'eve', matchReason: 'email', normalized: { name: 'Eve Renamed', email: 'eve@example.test', phone: '+14165550111', contact_type: 'unspecified', lifecycle: 'customer', custom: { industry: 'Food', website: '' } } });
    expect(importChanges(update, current, { industry: 'Industry' })).toEqual([
      { field: 'name', label: 'Name', current: 'Eve Original', incoming: 'Eve Renamed' },
      { field: 'phone', label: 'Phone', current: '—', incoming: '+14165550111' },
      { field: 'lifecycle', label: 'Lifecycle', current: 'Lead', incoming: 'Customer' },
      { field: 'custom.industry', label: 'Industry', current: 'Retail', incoming: 'Food' },
    ]);
  });
  it('shows the changes beside a row that will update a contact, before anything is applied', () => {
    const update = row('eve-row', 'Eve Renamed', { proposedAction: 'update', matchedCustomerId: 'eve', matchReason: 'email', normalized: { name: 'Eve Renamed' } });
    render(<ImportRunDetail organizationId="org" runId="run" run={run} rows={[update]} summary={summarizeStaging([update])} readyCount={1} contacts={new Map([['eve', current]])} />);
    // Current value struck through beside the incoming one, with words for a screen reader.
    const before = screen.getAllByText('Eve Original')[0];
    expect(before).toHaveClass('line-through');
    expect(before.closest('dd')).toHaveTextContent('from Eve Original → to Eve Renamed');
  });
  it('describes a row imported before from another file', () => {
    expect(matchDescription(row('x', 'Eve', { matchReason: 'source_other_file', candidateIds: ['eve'] }), contacts)).toBe('Imported before from another file as Eve Original');
  });
  it('never offers decisions to a role that may not view contacts', () => {
    render(<ImportRunDetail organizationId="org" runId="run" run={run} rows={rows} summary={summarizeStaging(rows)} readyCount={3} contacts={new Map()} mayReview={false} />);
    expect(screen.queryByRole('combobox', { name: /Decision for/ })).toBeNull();
  });
});
});
