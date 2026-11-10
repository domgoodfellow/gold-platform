import { beforeEach, expect, it, vi } from 'vitest';
import { contactImportSourcesAction, importContactWorksheetAction, refreshContactImportAccountAction } from '@/app/organizations/[organizationId]/library/imports/new/actions';

const reads = vi.hoisted(() => ({ context: vi.fn(), sources: vi.fn(), resources: vi.fn(), connection: vi.fn(), sync: vi.fn(), syncState: vi.fn(), check: vi.fn() }));
vi.mock('@/lib/route/organization', () => ({ requireOrganization: reads.context }));
vi.mock('@/lib/route/workspace-configuration', () => ({ loadConfigurationContext: reads.context }));
vi.mock('@/lib/db/server', () => ({ getDb: vi.fn() }));
vi.mock('@/lib/application/crm/contact-import', () => ({ loadContactImportSources: reads.sources }));
vi.mock('@/lib/domain/integrations/resources', () => ({ listResources: reads.resources, getResourceSync: reads.syncState }));
vi.mock('@/lib/domain/integrations/connections', () => ({ getConnection: reads.connection }));
vi.mock('@/lib/domain/integrations/oauth', () => ({ checkConnection: reads.check }));
vi.mock('@/app/organizations/[organizationId]/settings/connections/library-actions', () => ({ syncLibraryResource: reads.sync }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

const form = () => { const data = new FormData(); Object.entries({ organizationId: 'tenant', resourceId: 'sheet', range: 'Leads!A1:D51', key_column: '0' }).forEach(([key, value]) => data.set(key, value)); return data; };
beforeEach(() => {
  vi.clearAllMocks();
  reads.context.mockResolvedValue({ db: {}, organization: { capabilities: ['integration.manage', 'customer.create'] }, gate: {} });
  reads.resources.mockResolvedValue([{ id: 'sheet', resourceType: 'google_sheet', status: 'active', connectionId: 'account' }]);
  reads.connection.mockResolvedValue({ id: 'account', status: 'active', connectorKey: 'google_workspace' });
  reads.sources.mockResolvedValue({ accounts: [], worksheets: [], files: [], saved: [], providers: [] });
  reads.sync.mockResolvedValue({ error: null, message: null });
  reads.syncState.mockResolvedValue({ state: 'idle', last_success_at: '2026-11-10T12:00:00Z' });
});

it('refuses all intake reads and vendor work after the member loses write permission', async () => {
  reads.context.mockResolvedValue({ db: {}, organization: { capabilities: ['integration.manage'] }, gate: {} });
  expect((await contactImportSourcesAction('tenant')).sources).toBeNull();
  expect((await refreshContactImportAccountAction('tenant', 'account')).sources).toBeNull();
  expect((await importContactWorksheetAction({ error: null }, form())).error).toContain('Your role');
  for (const read of [reads.sources, reads.resources, reads.connection, reads.sync, reads.check]) expect(read).not.toHaveBeenCalled();
});
it('refuses a stale or foreign source before reading a credential or starting synchronization', async () => {
  reads.resources.mockResolvedValue([]);
  expect((await importContactWorksheetAction({ error: null }, form())).error).toContain('Choose a worksheet');
  expect(reads.resources).toHaveBeenCalledWith({}, { organizationId: 'tenant' });
  expect(reads.connection).not.toHaveBeenCalled();
  expect(reads.sync).not.toHaveBeenCalled();
  reads.connection.mockResolvedValue(null);
  expect((await refreshContactImportAccountAction('tenant', 'foreign')).error).toContain('unavailable');
  expect(reads.connection).toHaveBeenCalledWith({}, { organizationId: 'tenant', connectionId: 'foreign' });
  expect(reads.check).not.toHaveBeenCalled();
});
it('does not advance to mapping when the account is broken or synchronization is incomplete', async () => {
  reads.connection.mockResolvedValueOnce({ status: 'needs_attention' });
  expect((await importContactWorksheetAction({ error: null }, form())).error).toContain('Choose a worksheet');
  expect(reads.sync).not.toHaveBeenCalled();
  reads.syncState.mockResolvedValueOnce({ state: 'pending', last_success_at: '2026-11-09T12:00:00Z' });
  expect((await importContactWorksheetAction({ error: null }, form())).error).toContain('has not finished');
});
it('hands only the selected source and parameters to canonical synchronization before mapping', async () => {
  await expect(importContactWorksheetAction({ error: null }, form())).rejects.toThrow('redirect:/organizations/tenant/library/imports/new?resourceId=sheet');
  expect(Object.fromEntries(reads.sync.mock.calls[0][1])).toEqual({ organizationId: 'tenant', resourceId: 'sheet', intent: 'enable', range: 'Leads!A1:D51', key_column: '0' });
});
